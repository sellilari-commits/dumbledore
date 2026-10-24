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

/** The card plus room for its shadow (and menus that hang off it). */
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
  await expect(page.getByRole('list', { name: 'Organic Chemistry topics' })).toBeVisible()
  await expect(page.getByRole('button', { name: /subject: organic chemistry/i })).toBeVisible()
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`panel screenshots · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 560, height: 700 }, deviceScaleFactor: 2 })

    test('panel: topics and the subject menu', async ({ page }) => {
      await open(page)
      await loaded(page)
      await shoot(page, 'home', theme)

      await page.getByRole('button', { name: /subject: organic chemistry/i }).press('Enter')
      await expect(page.getByRole('menuitem', { name: /linear algebra/i })).toBeVisible()
      await shoot(page, 'focus', theme)
      await page.getByRole('menuitem', { name: /linear algebra/i }).click()
      await expect(page.getByRole('list', { name: 'Linear Algebra topics' })).toBeVisible()
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

  test('a topic opens the app; picking in the picker starts and returns to the topics', async ({
    page,
  }) => {
    const errors: string[] = []
    page.on('pageerror', (e) => errors.push(e.message))
    await open(page)
    await loaded(page)
    const popup = page.waitForEvent('popup')
    await page
      .getByRole('list', { name: 'Organic Chemistry topics' })
      .getByRole('button')
      .first()
      .click()
    expect((await popup).url()).toMatch(/subjects\/sub_orgo\/concepts/)

    await page.goto(`${base}/panel.html?mock=1&latency=0#/picker`)
    await page.getByRole('option', { name: /why does a rotation/i }).click()
    await expect(page).toHaveURL(/#\/$/)
    await expect(page.getByRole('button', { name: /subject:/i })).toBeVisible()
    expect(errors).toEqual([])
  })
})
