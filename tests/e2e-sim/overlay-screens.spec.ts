/**
 * Overlay and Ask bar in a plain browser with the mock driver (no Electron): screenshots every
 * state in light and dark to __screenshots__/overlay-<state>-<theme>.png, and checks that
 * gestures and clicks send the right OverlayActions / IPC calls. Starts its own Vite server.
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/overlay/vite.config.mjs')

interface Box {
  left: number
  top: number
  right: number
  bottom: number
}

/**
 * The page globals the evaluate() callbacks use. This project has no DOM lib, so callbacks reach
 * them through `globalThis as unknown as PageGlobals` (a type-only cast, erased in the page).
 */
interface PageGlobals {
  __ddMock: {
    actions: Array<{ type: string; [key: string]: unknown }>
    calls: Array<{ channel: string; payload: unknown }>
    state: () => { edge: string; orb: { x: number; y: number; dot: string } }
  }
  innerWidth: number
  innerHeight: number
  document: {
    querySelectorAll: (selector: string) => Iterable<{ getBoundingClientRect: () => Box }>
  }
}

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5191, strictPort: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5191/').replace(/\/$/, '')
})

test.afterAll(async () => {
  await server?.close()
})

const overlay = (page: Page, scene: string) =>
  page.goto(`${base}/overlay.html?scene=${scene}&clean=1&display=1`)

const actions = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as PageGlobals).__ddMock.actions.map((a) => a.type))

const calls = (page: Page) =>
  page.evaluate(() => (globalThis as unknown as PageGlobals).__ddMock.calls.map((c) => c.channel))

/** Frames every hit area (plus the tooltip) with some room around it. */
async function shoot(page: Page, name: string, theme: string) {
  await page.waitForTimeout(260)
  const clip = await page.evaluate(() => {
    const { document, innerWidth, innerHeight } = globalThis as unknown as PageGlobals
    const els = [...document.querySelectorAll('[data-hit], .ov-tip')]
    let [x0, y0, x1, y1] = [Number.POSITIVE_INFINITY, Number.POSITIVE_INFINITY, 0, 0]
    for (const el of els) {
      const r = el.getBoundingClientRect()
      ;[x0, y0, x1, y1] = [
        Math.min(x0, r.left),
        Math.min(y0, r.top),
        Math.max(x1, r.right),
        Math.max(y1, r.bottom),
      ]
    }
    const w = Math.min(innerWidth, Math.max(x1 - x0 + 96, 360))
    const h = Math.min(innerHeight, Math.max(y1 - y0 + 96, 240))
    const x = Math.min(Math.max(0, (x0 + x1) / 2 - w / 2), innerWidth - w)
    const y = Math.min(Math.max(0, (y0 + y1) / 2 - h / 2), innerHeight - h)
    return { x, y, width: w, height: h }
  })
  await page.screenshot({
    path: `${SHOTS}/overlay-${name}-${theme}.png`,
    clip,
    animations: 'disabled',
  })
}

const STATIC_SCENES = [
  'idle',
  'paused',
  'thinking',
  'attention',
  'pill',
  'docked',
  'improve',
  'toast',
  'tip',
  'checkpoint',
  'left',
]

for (const theme of ['light', 'dark'] as const) {
  test.describe(`overlay screenshots · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1280, height: 800 }, deviceScaleFactor: 2 })

    test('static states', async ({ page }) => {
      for (const scene of STATIC_SCENES) {
        await overlay(page, scene)
        await expect(page.getByTestId('orb')).toBeVisible()
        await shoot(page, scene, theme)
      }
    })

    test('session ring, side stack label and orb tooltip', async ({ page }) => {
      await overlay(page, 'session')
      await page.getByTestId('side-next').hover()
      await expect(page.locator('.ov-sq__label')).toHaveText('3/8')
      await shoot(page, 'session', theme)
      await page.getByTestId('orb').hover()
      await expect(page.getByRole('tooltip')).toHaveText(/Dumbledore\s*· right ⌥/)
      await shoot(page, 'tooltip', theme)
    })

    test('quiz card: question, feedback, result', async ({ page }) => {
      await overlay(page, 'quiz')
      const card = page.getByTestId('quiz-card')
      await expect(card.getByTestId('quiz-option')).toHaveCount(4)
      await shoot(page, 'quiz-question', theme)
      await card.getByTestId('quiz-option').nth(2).click() // wrong: secondary
      await expect(card.getByText('Not quite.')).toBeVisible()
      await shoot(page, 'quiz-feedback', theme)
      for (const pick of [0, 0, 1]) {
        await card.getByRole('button', { name: /Next/ }).click()
        await card.getByTestId('quiz-option').nth(pick).click()
      }
      await card.getByRole('button', { name: /See results/ }).click()
      await expect(card.getByText('3/4')).toBeVisible()
      await shoot(page, 'quiz-result', theme)
    })

    test('ask bar: empty and answered', async ({ page }) => {
      await page.goto(`${base}/askbar.html`)
      const bar = page.locator('.ask')
      await expect(page.getByPlaceholder(/Ask Dumbledore/)).toBeFocused()
      const frame = async () => {
        const b = await bar.boundingBox()
        if (!b) throw new Error('no ask bar')
        return { x: b.x - 48, y: b.y - 40, width: b.width + 96, height: b.height + 96 }
      }
      await page.waitForTimeout(200)
      await page.screenshot({
        path: `${SHOTS}/overlay-askbar-empty-${theme}.png`,
        clip: await frame(),
      })
      await page.keyboard.type("I don't get recursion")
      await page.keyboard.press('Enter')
      await expect(page.locator('.ask__chip')).toHaveCount(2)
      await page.waitForTimeout(250)
      await page.screenshot({
        path: `${SHOTS}/overlay-askbar-answer-${theme}.png`,
        clip: await frame(),
        animations: 'disabled',
      })
    })
  })
}

test.describe('overlay interactions', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('orb: click, right-click, long press, drag and hover', async ({ page }) => {
    await overlay(page, 'idle')
    const orb = page.getByTestId('orb')
    const box = await orb.boundingBox()
    if (!box) throw new Error('no orb')
    const cx = box.x + box.width / 2
    const cy = box.y + box.height / 2

    await page.mouse.move(cx, cy)
    await orb.click()
    await orb.click({ button: 'right' })
    await page.mouse.down()
    await page.waitForTimeout(650)
    await page.mouse.up()
    expect(await actions(page)).toEqual(
      expect.arrayContaining(['hover', 'orbClick', 'orbContextMenu', 'orbLongPress']),
    )

    // Drag to the left half: the mock snaps the orb to the left edge.
    await page.mouse.move(cx, cy)
    await page.mouse.down()
    await page.mouse.move(cx - 300, cy + 40, { steps: 8 })
    await page.mouse.move(200, cy + 80, { steps: 8 })
    await page.mouse.up()
    const drags = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).__ddMock.actions.filter((a) => a.type === 'orbDrag'),
    )
    expect(drags.length).toBeGreaterThan(1)
    expect(drags.at(-1)).toMatchObject({ done: true })
    await expect
      .poll(() => page.evaluate(() => (globalThis as unknown as PageGlobals).__ddMock.state().edge))
      .toBe('left')

    // Leaving the hit areas hands clicks back to the app below.
    await page.mouse.move(640, 700)
    const hovers = await page.evaluate(() =>
      (globalThis as unknown as PageGlobals).__ddMock.actions.filter((a) => a.type === 'hover'),
    )
    expect(hovers.at(-1)).toMatchObject({ inside: false })
  })

  test('pill, chip, side stack and toasts', async ({ page }) => {
    const clickSends = async (scene: string, testId: string, action: string) => {
      await overlay(page, scene)
      await page.getByTestId(testId).click()
      expect(await actions(page)).toContain(action)
    }
    await clickSends('pill', 'study-pill', 'pillClick')
    await clickSends('docked', 'suggestion-chip', 'chipClick')
    await clickSends('session', 'side-next', 'sideNext')
    await clickSends('checkpoint', 'side-quiz', 'sideQuiz')
    await expect(page.getByTestId('quiz-card')).toBeVisible()
    await page.getByRole('button', { name: 'Close quiz' }).click()
    expect(await actions(page)).toContain('quizClose')

    await overlay(page, 'toast')
    await page.getByRole('button', { name: 'Start quiz' }).click()
    expect(await actions(page)).toContain('toastAction')
    await overlay(page, 'toast')
    await page.getByTestId('toast').hover()
    await page.getByRole('button', { name: 'Dismiss' }).click()
    await expect.poll(() => actions(page)).toContain('toastDismiss')
    await expect(page.getByTestId('orb-dot')).toBeVisible()
  })

  test('quiz keys and Fix my gaps', async ({ page }) => {
    await overlay(page, 'quiz')
    await expect(page.getByTestId('quiz-option')).toHaveCount(4)
    for (const key of ['3', 'Enter', '1', 'Enter', '1', 'Enter', '2', 'Enter']) {
      await page.keyboard.press(key)
      await page.waitForTimeout(60)
    }
    await expect(page.getByText('3/4')).toBeVisible()
    await page.getByRole('button', { name: 'Fix my gaps' }).click()
    await expect(page.getByText('Pasted into your chat')).toBeVisible()
    expect(await calls(page)).toEqual(
      expect.arrayContaining(['quiz.get', 'quiz.answer', 'quiz.finish', 'prompt.sendToChat']),
    )
    await page.keyboard.press('Escape')
    expect(await actions(page)).toContain('quizClose')
  })

  test('ask bar: submit, run an action, Esc', async ({ page }) => {
    await page.goto(`${base}/askbar.html`)
    await page.keyboard.type('quiz me now')
    await page.keyboard.press('Enter')
    await page.locator('.ask__chip').first().click()
    await expect
      .poll(() => calls(page))
      .toEqual(
        expect.arrayContaining(['ask.submit', 'coach.runAction', 'window.close', 'window.setSize']),
      )
    await page.keyboard.press('Escape')
    const closes = (await calls(page)).filter((c) => c === 'window.close')
    expect(closes.length).toBe(2)
  })
})
