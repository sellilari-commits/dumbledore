/**
 * The Ask bar as a chat with Dumbledore, in a plain browser with its mock driver (no Electron):
 * screenshots of the compact bar, a 3-turn chat, a long scrolled chat and the prompt box in
 * light and dark to __screenshots__/askbar-<state>-<theme>.png, plus multi-turn, Shift+Enter,
 * New chat and prompt-box checks. Starts its own Vite server (port 5187).
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/overlay/vite.config.mjs')

/** Page globals for evaluate() (this project has no DOM lib; a type-only cast). */
interface PageGlobals {
  __ddMock: { calls: Array<{ channel: string; payload: unknown }> }
  document: {
    querySelector: (s: string) => { scrollTop: number; scrollHeight: number; clientHeight: number }
  }
}

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5187, strictPort: true },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5187/').replace(/\/$/, '')
})

test.afterAll(async () => {
  await server?.close()
})

test.use({ viewport: { width: 1280, height: 900 } })

const calls = (page: Page, channel: string) =>
  page.evaluate(
    (name) =>
      (globalThis as unknown as PageGlobals).__ddMock.calls
        .filter((c) => c.channel === name)
        .map((c) => c.payload),
    channel,
  )

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(250)
  const b = await page.locator('.ask').boundingBox()
  if (!b) throw new Error('no ask bar')
  await page.screenshot({
    path: `${SHOTS}/askbar-${name}.png`,
    clip: { x: b.x - 48, y: b.y - 40, width: b.width + 96, height: b.height + 96 },
    animations: 'disabled',
  })
}

async function send(page: Page, text: string, replies: number) {
  await page.getByRole('textbox', { name: 'Ask Dumbledore' }).fill(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('.ask__msg--assistant')).toHaveCount(replies)
  await expect(page.locator('.ask__busy')).toHaveCount(0)
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`ask bar chat (${theme})`, () => {
    test('empty chat panel', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}`)
      // Same constant size when empty: no growing from a short bar.
      const box = await page.locator('.ask').boundingBox()
      expect(Math.round(box?.height ?? 0)).toBe(520)
      await expect(page.getByPlaceholder(/Ask Dumbledore/)).toBeFocused()
      await shoot(page, `compact-${theme}`)
    })

    test('three-turn chat', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}`)
      await send(page, 'chemistry', 1)
      await send(page, 'moles — I keep mixing up mass and moles', 2)
      await send(page, 'quiz me on it', 3)
      await expect(page.locator('.ask__msg--user')).toHaveCount(3)
      await expect(page.getByPlaceholder('Reply to Dumbledore…')).toBeFocused()
      await shoot(page, `chat-${theme}`)
    })

    test('long chat scrolls to the newest message', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&seed=5`)
      await expect(page.locator('.ask__msg--user')).toHaveCount(5)
      await send(page, 'quiz me on moles', 6)
      // The double-tap chat is a constant 380 × 520 box: a long chat scrolls inside it.
      const box = await page.locator('.ask').boundingBox()
      expect(Math.round(box?.width ?? 0)).toBe(380)
      expect(Math.round(box?.height ?? 0)).toBe(520)
      const log = await page.evaluate(() => {
        const el = (globalThis as unknown as PageGlobals).document.querySelector('.ask__log')
        return { top: el.scrollTop, gap: el.scrollHeight - el.scrollTop - el.clientHeight }
      })
      expect(log.top).toBeGreaterThan(0)
      expect(log.gap).toBeLessThanOrEqual(2)
      await expect(page.locator('.ask__chip').last()).toBeInViewport()
      await shoot(page, `long-${theme}`)
    })

    test('prompt box', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}#/prompt`)
      await expect(page.locator('.ask__prompt-note')).toContainText('ChatGPT')
      await shoot(page, `prompt-${theme}`)
    })
  })
}

test.describe('ask bar chat interactions', () => {
  test('Shift+Enter adds a line; Enter sends both lines', async ({ page }) => {
    await page.goto(`${base}/askbar.html`)
    const box = page.getByRole('textbox', { name: 'Ask Dumbledore' })
    await box.pressSequentially('line one')
    await page.keyboard.press('Shift+Enter')
    await box.pressSequentially('line two')
    expect(await calls(page, 'ask.submit')).toEqual([])
    const tall = await box.boundingBox()
    expect(tall?.height ?? 0).toBeGreaterThan(40)
    await page.keyboard.press('Enter')
    await expect(page.locator('.ask__msg--user')).toHaveText('line one\nline two')
    expect(await calls(page, 'ask.submit')).toEqual([{ text: 'line one\nline two' }])
  })

  test('New chat starts over, survives a reload, and is sent as since', async ({ page }) => {
    await page.goto(`${base}/askbar.html?seed=2&topics=0`)
    await expect(page.locator('.ask__msg--user')).toHaveCount(2)
    await page.getByRole('button', { name: 'New chat' }).click()
    await expect(page.locator('.ask__log')).toHaveCount(0)
    await expect(page.getByPlaceholder(/Ask Dumbledore/)).toBeFocused()
    await expect(page.getByTestId('ask-empty')).toBeVisible()
    await send(page, 'chemistry', 1)
    const [payload] = (await calls(page, 'ask.submit')) as Array<{ since?: string }>
    expect(payload?.since).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    await page.reload()
    await expect(page.locator('.ask__log')).toHaveCount(0)
  })

  test('prompt box: Enter sends the wish as prompt.write', async ({ page }) => {
    await page.goto(`${base}/askbar.html#/prompt`)
    const box = page.getByRole('textbox', { name: 'What do you want to study?' })
    await box.pressSequentially('explain SN1 simply, I have an exam Friday')
    await page.keyboard.press('Enter')
    await expect(page.getByText('Building your roadmap…')).toBeVisible()
    expect(await calls(page, 'prompt.write')).toEqual([
      { context: 'explain SN1 simply, I have an exam Friday' },
    ])
    expect(await calls(page, 'ask.submit')).toEqual([])
  })
})
