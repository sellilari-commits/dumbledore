/**
 * Mini panel and study picker in a plain browser against the mock API (no Electron): screenshots
 * in light and dark to __screenshots__/ui-panel-<state>-<theme>.png, plus smoke checks that the
 * main flows work end to end. Starts its own Vite server (panel config, port 5185).
 */
import { resolve } from 'node:path'
import { expect, type Locator, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/panel/vite.config.mjs')

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5185, strictPort: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5185/').replace(/\/$/, '')
})

test.afterAll(async () => {
  await server?.close()
})

const open = (page: Page, hash = '/', query = '') =>
  page.goto(`${base}/panel.html?mock=1&latency=0${query}#${hash}`)

const card = (page: Page): Locator => page.locator('.pn-card')

/** The card plus room for its shadow and the lock's tooltip. */
async function shoot(page: Page, name: string, theme: string, extra = 0) {
  await page.waitForTimeout(220)
  const box = await card(page).boundingBox()
  if (!box) throw new Error('no panel card')
  await page.screenshot({
    path: `${SHOTS}/ui-panel-${name}-${theme}.png`,
    clip: { x: box.x - 24, y: box.y - 20, width: box.width + 48, height: box.height + 44 + extra },
    animations: 'disabled',
  })
}

async function loaded(page: Page) {
  await expect(page.getByRole('list', { name: 'Topics' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Lock topic' })).toBeVisible()
}

const topics = (page: Page) => page.getByRole('list', { name: 'Topics' }).getByRole('button')

/** Opens a detail section that starts closed ("Roadmap", "Your notes", "Extracted"). */
async function openSection(page: Page, title: string) {
  const head = page.getByRole('button', { name: new RegExp(`^${title}, `) })
  await expect(head).toHaveAttribute('aria-expanded', 'false')
  await head.click()
  await expect(head).toHaveAttribute('aria-expanded', 'true')
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`panel screenshots · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 560, height: 700 }, deviceScaleFactor: 2 })

    test('panel: topic names, then a locked topic', async ({ page }) => {
      await open(page)
      await loaded(page)
      await expect(page.getByRole('button', { name: /subject:/i })).toHaveCount(0)
      await shoot(page, 'home', theme)

      await page.getByRole('button', { name: 'Lock topic' }).click()
      await expect(page.getByRole('button', { name: 'Unlock topic' })).toBeVisible()
      await page.mouse.move(0, 0)
      await shoot(page, 'locked', theme)
    })

    test('panel: a topic with its roadmap and flags, and one with flags only', async ({ page }) => {
      await open(page)
      await loaded(page)
      await topics(page).filter({ hasText: 'Carbocation stability' }).click()
      await openSection(page, 'Roadmap')
      await openSection(page, 'Your notes')
      await expect(page.getByRole('list', { name: 'Roadmap steps' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Your notes' })).toBeVisible()
      await page.mouse.move(0, 0)
      await shoot(page, 'detail', theme)

      await page.getByRole('button', { name: 'Back to topics' }).click()
      await topics(page).filter({ hasText: 'Plate tectonics' }).click()
      await expect(page.getByRole('heading', { name: 'Plate tectonics' })).toBeVisible()
      await openSection(page, 'Your notes')
      await expect(page.getByRole('list', { name: 'Your notes' })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Roadmap steps' })).toHaveCount(0)
      await page.mouse.move(0, 0)
      await shoot(page, 'detail-flags', theme)
    })

    test('panel: a topic with subtopics, roadmap, notes and extracted; then a subtopic', async ({
      page,
    }) => {
      await open(page, '/', '&subtopics=1')
      await loaded(page)
      await topics(page).filter({ hasText: 'Carbocation stability' }).click()
      // The tree is always fully open; everything else starts closed to one line.
      await expect(page.getByRole('list', { name: 'Subtopics', exact: true })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Hydride shifts' })).toBeVisible()
      await expect(page.getByRole('button', { name: /^Roadmap, step \d+ of \d+$/ })).toBeVisible()
      await expect(page.getByRole('list', { name: 'Roadmap steps' })).toHaveCount(0)
      await expect(page.getByRole('list', { name: 'Your notes' })).toHaveCount(0)
      // One lock on screen: the detail's own.
      await expect(page.getByRole('button', { name: 'Lock topic' })).toBeHidden()
      await page.mouse.move(0, 0)
      await shoot(page, 'detail-subtopics', theme)

      await openSection(page, 'Roadmap')
      await openSection(page, 'Your notes')
      await openSection(page, 'Extracted')
      await expect(page.getByRole('list', { name: 'Extracted' })).toContainText(
        'Wikipedia · 20 min',
      )
      await expect(page.getByRole('list', { name: 'Extracted' })).not.toContainText('Ilari')
      await page.getByRole('list', { name: 'Extracted' }).getByRole('button').first().click()
      await page.mouse.move(0, 0)
      await shoot(page, 'detail-note-open', theme)

      await page.getByRole('button', { name: 'Hydride shifts' }).click()
      await expect(page.getByRole('heading', { name: 'Hydride shifts' })).toBeVisible()
      await openSection(page, 'Your notes')
      await expect(page.getByRole('list', { name: 'Your notes' })).toContainText(
        'Chemistry LibreTexts',
      )
      await page.mouse.move(0, 0)
      await shoot(page, 'detail-subtopic', theme)
      await page.getByRole('button', { name: 'Back to Carbocation stability' }).click()
      await expect(page.getByRole('heading', { name: 'Carbocation stability' })).toBeVisible()
    })

    test('panel: first day (empty)', async ({ page }) => {
      await open(page, '/', '&scenario=empty')
      await expect(page.getByText(/nothing yet\. read or highlight/i)).toBeVisible()
      await shoot(page, 'empty', theme)
    })

    test('picker: subjects with questions, then typing', async ({ page }) => {
      await open(page, '/picker')
      const input = page.getByRole('combobox', { name: /what do you want to learn/i })
      await expect(input).toBeFocused()
      await expect(page.getByRole('option')).toHaveCount(7)
      await shoot(page, 'picker', theme)
      await input.fill('hyper')
      await input.press('ArrowDown')
      await expect(page.getByRole('option', { selected: true })).toContainText('Organic Chemistry')
      await shoot(page, 'picker-typed', theme)
    })
  })
}

test.describe('panel flows', () => {
  test.use({ viewport: { width: 560, height: 700 } })

  test('a topic opens its detail (no app opens), locks there; back and Esc return to topics', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    let popups = 0
    page.on('popup', () => popups++)
    await open(page)
    await loaded(page)
    const newest = topics(page).first()
    await expect(newest).toHaveAttribute('aria-current', 'true')
    const pick = topics(page).last()
    const name = (await pick.locator('.pn-topic__name').textContent()) ?? ''
    await pick.click()
    await expect(page.getByRole('heading', { name })).toBeVisible()
    await page.getByRole('button', { name: 'Lock this topic' }).click()
    await expect(page.getByRole('button', { name: 'Unlock this topic' })).toBeVisible()
    await page.getByRole('button', { name: 'Back to topics' }).click()
    await expect(topics(page).last()).toHaveAttribute('aria-current', 'true')
    await page.getByRole('button', { name: 'Unlock topic' }).click()
    await expect(page.getByRole('button', { name: 'Lock topic' })).toBeVisible()
    await expect(topics(page).first()).toHaveAttribute('aria-current', 'true')
    await topics(page).first().click()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('list', { name: 'Topics' })).toBeVisible()
    expect(popups).toBe(0)

    await page.goto(`${base}/panel.html?mock=1&latency=0#/picker`)
    await page.getByRole('option', { name: /why does a rotation/i }).click()
    await expect(page).toHaveURL(/#\/$/)
    await loaded(page)
    expect(errors).toEqual([])
  })
})
