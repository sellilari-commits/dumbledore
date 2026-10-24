/**
 * The Ask bar's topic row (chat mode, double-tap right ⌥) in a plain browser with its mock driver
 * (9 subjects, so the row overflows): screenshots of the row, a topic selected mid-row (both fades
 * and arrows) and a chat about a topic in light and dark to
 * __screenshots__/askbar-topics-<state>-<theme>.png, plus select/deselect, ↵ with and without
 * text, ←/→ and sideways-scroll checks. Starts its own Vite server (port 5189).
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
    querySelector: (s: string) => { scrollLeft: number; scrollWidth: number; clientWidth: number }
  }
}

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5189, strictPort: true },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5189/').replace(/\/$/, '')
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

const scrollLeft = (page: Page) =>
  page.evaluate(
    () =>
      (globalThis as unknown as PageGlobals).document.querySelector('.ask__topics-track')
        .scrollLeft,
  )

async function shoot(page: Page, name: string) {
  await page.waitForTimeout(400)
  const b = await page.locator('.ask').boundingBox()
  if (!b) throw new Error('no ask bar')
  await page.screenshot({
    path: `${SHOTS}/askbar-topics-${name}.png`,
    clip: { x: b.x - 48, y: b.y - 40, width: b.width + 96, height: b.height + 96 },
    animations: 'disabled',
  })
}

const input = (page: Page) => page.getByRole('textbox', { name: 'Ask Dumbledore' })
const topic = (page: Page, name: string) => page.locator('.ask__topic', { hasText: name })
const selected = (page: Page) => page.locator('.ask__topic[aria-pressed="true"]')

for (const theme of ['light', 'dark'] as const) {
  test.describe(`ask bar topics (${theme})`, () => {
    test('row of recent topics', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}`)
      await expect(page.locator('.ask__topic')).toHaveCount(9)
      await expect(page.locator('.ask__topics-arrow--next')).toBeVisible()
      await expect(page.locator('.ask__topics-arrow--prev')).toHaveCount(0)
      await expect(input(page)).toBeFocused()
      await shoot(page, `row-${theme}`)
    })

    test('topic selected mid-row', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}`)
      await expect(page.locator('.ask__topic')).toHaveCount(9)
      for (let i = 0; i < 6; i++) await page.keyboard.press('ArrowRight')
      await expect(selected(page)).toHaveText(/Spanish B1/)
      await expect(page.locator('.ask__topics-arrow--prev')).toBeVisible()
      await expect(page.locator('.ask__topics-arrow--next')).toBeVisible()
      await expect(page.getByPlaceholder('Ask about Spanish B1…')).toBeVisible()
      await shoot(page, `selected-${theme}`)
    })

    test('chat about a topic', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}`)
      await topic(page, 'Organic chemistry').click()
      await input(page).fill('why is SN1 faster with tertiary carbons?')
      await page.keyboard.press('Enter')
      await expect(page.locator('.ask__msg--assistant')).toHaveCount(1)
      await expect(page.locator('.ask__busy')).toHaveCount(0)
      await expect(page.getByPlaceholder('Reply about Organic chemistry…')).toBeFocused()
      await shoot(page, `chat-${theme}`)
    })
  })
}

test.describe('ask bar topic interactions', () => {
  test('click selects and deselects without any call', async ({ page }) => {
    await page.goto(`${base}/askbar.html`)
    await topic(page, 'Calculus II').click()
    await expect(selected(page)).toHaveText(/Calculus II/)
    await expect(input(page)).toBeFocused()
    await topic(page, 'Calculus II').click()
    await expect(selected(page)).toHaveCount(0)
    expect(await calls(page, 'session.start')).toEqual([])
    expect(await calls(page, 'ask.submit')).toEqual([])
  })

  test('Enter with text sends the topic as subjectId', async ({ page }) => {
    await page.goto(`${base}/askbar.html`)
    await topic(page, 'Algorithms').click()
    await input(page).fill('quicksort worst case?')
    await page.keyboard.press('Enter')
    await expect(page.locator('.ask__msg--assistant')).toHaveCount(1)
    expect(await calls(page, 'ask.submit')).toEqual([
      { text: 'quicksort worst case?', subjectId: 'sub_algo' },
    ])
  })

  test('Enter on an empty input studies the topic and closes; with none, nothing', async ({
    page,
  }) => {
    await page.goto(`${base}/askbar.html`)
    await expect(page.locator('.ask__topic')).toHaveCount(9)
    await page.keyboard.press('Enter')
    expect(await calls(page, 'session.start')).toEqual([])
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowRight')
    await expect(selected(page)).toHaveText(/Calculus II/)
    await expect(page.getByText('Study')).toBeVisible()
    await page.keyboard.press('Enter')
    await expect.poll(() => calls(page, 'window.close')).toEqual(['askbar'])
    expect(await calls(page, 'session.start')).toEqual([
      { subjectId: 'sub_calc', goal: null, question: null },
    ])
    expect(await calls(page, 'ask.submit')).toEqual([])
  })

  test('sideways scroll and the › arrow move the row', async ({ page }) => {
    await page.goto(`${base}/askbar.html`)
    await expect(page.locator('.ask__topic')).toHaveCount(9)
    await page.locator('.ask__topics-track').hover()
    await page.mouse.wheel(0, 200)
    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(0)
    await expect(page.locator('.ask__topics-arrow--prev')).toBeVisible()
    await page.locator('.ask__topics-arrow--prev').click()
    await expect.poll(() => scrollLeft(page)).toBe(0)
    await page.locator('.ask__topics-arrow--next').click()
    await expect.poll(() => scrollLeft(page)).toBeGreaterThan(0)
    await expect(input(page)).toBeFocused()
  })

  test('no topics: the plain chat panel', async ({ page }) => {
    await page.goto(`${base}/askbar.html?topics=0`)
    await expect(input(page)).toBeFocused()
    await expect(page.locator('.ask__topics')).toHaveCount(0)
    await expect(page.getByTestId('ask-empty')).toBeVisible()
  })

  test('the prompt box has no topic row', async ({ page }) => {
    await page.goto(`${base}/askbar.html#/prompt`)
    await expect(page.locator('.ask__prompt-note')).toBeVisible()
    await expect(page.locator('.ask__topics')).toHaveCount(0)
    expect(await calls(page, 'session.picker')).toEqual([])
  })
})
