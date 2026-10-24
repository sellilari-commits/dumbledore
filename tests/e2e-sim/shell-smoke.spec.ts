/**
 * Shell smoke test in real Electron (Playwright `_electron`). Launches the built app
 * (out/main/index.js; run `npx electron-vite build` first) in test mode with a throwaway data
 * folder and the fake helper (nothing reads the screen), then checks that:
 * - one overlay window per display loads our page with the preload API and never takes focus;
 * - IPC round-trips work from a renderer, bad payloads are refused, the CSP blocks eval;
 * - the mini panel opens from an IPC call and loads as its own surface;
 * - the test-control channel answers and startup reports the overlays and the tray;
 * - quiz-card keys injected with sendInputEvent reach the non-focusable overlay.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import {
  type ElectronApplication,
  _electron as electron,
  expect,
  type Page,
  test,
} from '@playwright/test'
import type { DumbledoreApi } from '@shared/ipc'

const ROOT = resolve(__dirname, '../..')
const MAIN = resolve(ROOT, 'out/main/index.js')

/** Page globals for evaluate() callbacks (this project has no DOM lib; type-only cast). */
interface PageGlobals {
  dumbledore: DumbledoreApi
  __ddInline?: boolean
  document: {
    createElement: (tag: 'script') => { textContent: string }
    head: { appendChild: (node: unknown) => void }
  }
}

interface WindowInfo {
  url: string
  visible: boolean
  focusable: boolean
  onTop: boolean
}

let app: ElectronApplication
let dataDir: string
const logs: string[] = []

test.describe.configure({ mode: 'serial' })

test.beforeAll(async () => {
  if (!existsSync(MAIN)) throw new Error(`${MAIN} is missing — run \`npx electron-vite build\``)
  dataDir = mkdtempSync(join(tmpdir(), 'dd-e2e-'))
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && key !== 'ELECTRON_RENDERER_URL') env[key] = value
  }
  app = await electron.launch({
    args: [MAIN],
    cwd: ROOT,
    env: { ...env, DUMBLEDORE_TEST: '1', DUMBLEDORE_DATA_DIR: dataDir },
    timeout: 30_000,
  })
  app.process().stdout?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
  app.process().stderr?.on('data', (chunk: Buffer) => logs.push(chunk.toString()))
})

test.afterAll(async () => {
  await app?.close()
  if (dataDir) rmSync(dataDir, { recursive: true, force: true })
})

function windowInfo(): Promise<WindowInfo[]> {
  return app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().map((w) => ({
      url: w.webContents.getURL(),
      visible: w.isVisible(),
      focusable: w.isFocusable(),
      onTop: w.isAlwaysOnTop(),
    })),
  )
}

async function pagesOf(page: string, count = 1): Promise<Page[]> {
  const matching = () => app.windows().filter((p) => p.url().includes(`/${page}.html`))
  await expect.poll(() => matching().length, { timeout: 20_000 }).toBeGreaterThanOrEqual(count)
  return matching()
}

/** Calls the test-control channel (port and token from <data dir>/run/test-control.json). */
async function control(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
  const file = join(dataDir, 'run', 'test-control.json')
  await expect.poll(() => existsSync(file), { timeout: 20_000 }).toBe(true)
  const info = JSON.parse(readFileSync(file, 'utf8')) as { port: number; token: string }
  const res = await fetch(`http://127.0.0.1:${info.port}${path}`, {
    method,
    headers: { Authorization: `Bearer ${info.token}`, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const json: unknown = await res.json()
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(json)}`)
  return json
}

const invoke = async (channel: string, payload?: unknown) =>
  ((await control('POST', '/invoke', { channel, payload })) as { result: unknown }).result

test('loads one non-focusable, always-on-top overlay per display', async () => {
  const displays = await app.evaluate(({ screen }) => screen.getAllDisplays().length)
  const overlays = await pagesOf('overlay', displays)
  expect(overlays).toHaveLength(displays)
  const isOverlay = (w: WindowInfo) => w.url.includes('/overlay.html')
  await expect
    .poll(async () => (await windowInfo()).filter((w) => isOverlay(w) && w.visible).length)
    .toBe(displays)
  for (const w of (await windowInfo()).filter(isOverlay)) {
    expect(w).toMatchObject({ focusable: false, onTop: true })
    expect(w.url).toMatch(/^dumbledore:\/\/renderer\/overlay\.html\?display=\d+$/)
  }
  // Exactly one overlay draws the orb: the one on the orb's display.
  const orbCount = async () => {
    const counts = await Promise.all(overlays.map((p) => p.locator('[data-testid="orb"]').count()))
    return counts.reduce((a, b) => a + b, 0)
  }
  await expect.poll(orbCount, { timeout: 10_000 }).toBe(1)
})

test('round-trips IPC from a renderer, refuses bad payloads, enforces the CSP', async () => {
  const [page] = await pagesOf('overlay')
  if (!page) throw new Error('no overlay page')
  expect(await page.evaluate(() => (globalThis as unknown as PageGlobals).dumbledore.surface)).toBe(
    'overlay',
  )
  const settings = await page.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('settings.get'),
  )
  expect(settings).toMatchObject({ theme: 'system', captureEnabled: true })
  const profile = await page.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('profile.update', {
      aboutMe: 'E2E student',
    }),
  )
  expect(profile.aboutMe).toBe('E2E student')
  const refused = await page.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('subjects.get', '').then(
      () => 'accepted',
      (error: Error) => error.message,
    ),
  )
  expect(refused).toContain('Invalid payload')
  // script-src 'self': an injected inline script must not run.
  const inlineRan = await page.evaluate(() => {
    const g = globalThis as unknown as PageGlobals
    const script = g.document.createElement('script')
    script.textContent = 'globalThis.__ddInline = true'
    g.document.head.appendChild(script)
    return g.__ddInline === true
  })
  expect(inlineRan).toBe(false)
})

test('opens the mini panel from an IPC call; it loads as its own surface', async () => {
  const [overlay] = await pagesOf('overlay')
  if (!overlay) throw new Error('no overlay page')
  await overlay.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('window.open', {
      surface: 'panel',
      route: null,
    }),
  )
  const [panel] = await pagesOf('panel')
  if (!panel) throw new Error('no panel page')
  await panel.waitForLoadState('domcontentloaded')
  expect(
    await panel.evaluate(() => (globalThis as unknown as PageGlobals).dumbledore.surface),
  ).toBe('panel')
  const state = await panel.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('app.getState'),
  )
  expect(state.helper).toBe('connected')
  const panelVisible = async () =>
    (await windowInfo()).find((w) => w.url.includes('/panel.html'))?.visible ?? null
  await expect.poll(panelVisible).toBe(true)
  await panel.evaluate(() =>
    (globalThis as unknown as PageGlobals).dumbledore.invoke('window.close', 'panel'),
  )
  await expect.poll(panelVisible).toBe(false)
})

test('answers the test-control channel and reports the tray at startup', async () => {
  const windows = (await control('GET', '/state/windows')) as { overlays: unknown[]; tray: boolean }
  expect(windows.tray).toBe(true)
  expect(windows.overlays.length).toBeGreaterThan(0)
  expect(await control('GET', '/state/app')).toMatchObject({ helper: 'connected' })
  expect(logs.join('')).toMatch(/\[dumbledore\] ready: \d+ overlay window\(s\), tray icon/)
})

test('forwards quiz-card keys into the non-focusable overlay', async () => {
  const subjects = (await invoke('subjects.list')) as { id: string; name: string }[]
  const orgo = subjects.find((s) => s.name === 'Organic Chemistry')
  if (!orgo) throw new Error('demo seed missing')
  // A step only counts once its paste is confirmed, so give the fake helper a ChatGPT window it
  // can type into (by default it cannot type at all).
  const chatgpt = {
    pid: 4242,
    bundleId: 'com.openai.chat',
    appName: 'ChatGPT',
    windowId: 1,
    windowTitle: 'ChatGPT',
    windowFrame: null,
    isFullScreen: false,
    url: null,
  }
  await control('POST', '/fake/helper/state', {
    apps: [chatgpt],
    frontmost: chatgpt,
    chatInput: { found: true, frame: null, ref: 'ax-4242-input', method: 'ax_search' },
    writeResult: { ok: true, method: 'ax', verified: true, reason: null },
  })
  await control('POST', '/fake/perception', {
    aiChat: {
      key: 'chatgpt',
      assistant: 'ChatGPT',
      pid: 4242,
      bundleId: 'com.openai.chat',
      url: null,
      windowTitle: 'ChatGPT',
    },
  })
  await invoke('session.start', { subjectId: orgo.id, goal: null, question: null })
  await invoke('session.next')
  await invoke('session.next')
  // A checkpoint first asks "quiz or continue?" beside the orb; Quiz opens the card.
  type Toasts = { toasts: { id: string; title: string }[] }
  const checkpoint = async () =>
    ((await control('GET', '/state/overlay')) as Toasts).toasts.find(
      (t) => t.title === 'Checkpoint',
    )
  await expect.poll(checkpoint).toBeTruthy()
  const box = await checkpoint()
  await invoke('overlay.action', { type: 'toastAction', toastId: box?.id ?? '', actionId: 'quiz' })
  const quizOpen = async () =>
    ((await control('GET', '/state/overlay')) as { quiz: { quizId: string } | null }).quiz
  await expect.poll(quizOpen).not.toBeNull()

  const overlays = await pagesOf('overlay')
  const withCard = async () => {
    for (const p of overlays)
      if ((await p.locator('[data-testid="quiz-card"]').count()) > 0) return p
    return null
  }
  await expect.poll(async () => (await withCard()) !== null, { timeout: 10_000 }).toBe(true)
  const page = (await withCard()) as Page
  const first = page.locator('[data-testid="quiz-option"]').first()
  await expect(first).toBeVisible({ timeout: 10_000 })

  await control('POST', '/key', { key: '1' })
  await expect(first).toHaveAttribute('aria-pressed', 'true')
  await expect(page.locator('.ov-quiz__why')).toBeVisible()

  await control('POST', '/key', { key: 'Escape' })
  await expect.poll(quizOpen).toBeNull()
  await invoke('session.end')
})
