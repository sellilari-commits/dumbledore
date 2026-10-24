/**
 * Home and Inbox in a plain browser against the mock API (?mock=1): screenshots in light and dark
 * to __screenshots__/ui-home-*.png and ui-inbox-*.png (the 1200×800 window, plus the whole page),
 * the first-day / loading states, and a few real-browser interactions. Uses PREVIEW_URL when set
 * (e.g. http://localhost:5182), otherwise starts its own Vite preview server on 5182 or the next
 * free port.
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/app/vite.preview.config.mjs')

/** Page globals the evaluate() callbacks use (this project's test tsconfig has no DOM lib). */
interface PageGlobals {
  document: { querySelector: (s: string) => { scrollHeight: number } | null }
}

let server: ViteDevServer | null = null
let base = (process.env.PREVIEW_URL ?? '').replace(/\/$/, '')

test.beforeAll(async ({ browser }) => {
  if (!base) {
    server = await createServer({
      configFile: CONFIG,
      logLevel: 'error',
      server: { port: 5182, strictPort: false },
    })
    await server.listen()
    base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5182/').replace(/\/$/, '')
  }
  // Warm-up: a cold Vite server optimises dependencies on first load and may reload the page
  // mid-test; load both pages once so the tests start on a warm server.
  const page = await browser.newPage()
  for (const route of ['/home', '/inbox']) {
    await page.goto(`${base}/app.html?mock=1&latency=0#${route}`)
    await page.getByRole('main').getByRole('heading', { level: 1 }).waitFor()
  }
  await page.waitForLoadState('networkidle')
  await page.close()
})

test.afterAll(async () => {
  await server?.close()
})

type Theme = 'light' | 'dark'

async function open(page: Page, route: string, theme: Theme, scenario?: string) {
  const q = new URLSearchParams({ mock: '1', theme, latency: '0' })
  if (scenario) q.set('scenario', scenario)
  await page.goto(`${base}/app.html?${q}#${route}`)
}

/** The 1200×800 window, then the whole scrolling page in one tall image. */
async function shoot(page: Page, name: string) {
  await page.waitForTimeout(300)
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: 'disabled' })
  const height = await page.evaluate(() => {
    const el = (globalThis as unknown as PageGlobals).document.querySelector('.dd-app__scroll')
    return el ? el.scrollHeight + 44 : 800
  })
  if (height > 820) {
    await page.setViewportSize({ width: 1200, height: Math.min(height, 4000) })
    await page.waitForTimeout(200)
    await page.screenshot({ path: `${SHOTS}/${name}-full.png`, animations: 'disabled' })
    await page.setViewportSize({ width: 1200, height: 800 })
  }
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`home & inbox screenshots · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })

    test('home', async ({ page }) => {
      await open(page, '/home', theme)
      await expect(
        page.getByRole('heading', { name: /^Good (morning|afternoon|evening)/ }),
      ).toBeVisible()
      await expect(page.getByRole('link', { name: 'SN1 vs SN2' })).toBeVisible()
      await shoot(page, `ui-home-${theme}`)
    })

    test('inbox', async ({ page }) => {
      await open(page, '/inbox', theme)
      await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible()
      await expect(page.getByRole('article').first()).toBeVisible()
      await shoot(page, `ui-inbox-${theme}`)
    })
  })
}

test.describe('home & inbox states', () => {
  test.use({ colorScheme: 'light', viewport: { width: 1200, height: 800 }, deviceScaleFactor: 2 })

  test('first day, loading and error', async ({ page }) => {
    await open(page, '/home', 'light', 'empty')
    await expect(page.getByText('Nothing here yet — and that’s fine')).toBeVisible()
    await shoot(page, 'ui-home-empty-light')

    await open(page, '/home', 'light', 'slow')
    await expect(page.getByText('Gathering your roadmaps, reviews and deadlines…')).toBeVisible()
    await shoot(page, 'ui-home-loading-light')

    await open(page, '/inbox', 'light', 'empty')
    await expect(page.getByText('Nothing captured yet')).toBeVisible()
    await shoot(page, 'ui-inbox-empty-light')

    await open(page, '/inbox', 'light', 'error')
    await expect(page.getByText('Couldn’t load your memory')).toBeVisible()
    await shoot(page, 'ui-inbox-error-light')
  })

  test('add deadline row', async ({ page }) => {
    await open(page, '/home', 'light')
    await page.getByRole('button', { name: 'Add deadline' }).click()
    await page.getByLabel('Deadline title').fill('Lab report 2')
    await page.getByLabel('Due date').fill('2026-11-20')
    await page.getByRole('button', { name: 'Subject', exact: true }).click()
    await page.getByRole('menuitem', { name: /Organic Chemistry/ }).click()
    await page.getByRole('region', { name: 'Upcoming deadlines' }).scrollIntoViewIfNeeded()
    await page.waitForTimeout(250)
    await page.screenshot({
      path: `${SHOTS}/ui-home-add-deadline-light.png`,
      animations: 'disabled',
    })
    await page.getByRole('button', { name: 'Add', exact: true }).click()
    await expect(page.getByRole('link', { name: /Lab report 2/ })).toBeVisible()
  })
})

test.describe('home & inbox interactions', () => {
  test.use({ viewport: { width: 1200, height: 800 } })

  test('Start 5-min review opens the review exam', async ({ page }) => {
    await open(page, '/home', 'light')
    await page.getByRole('button', { name: 'Start 5-min review' }).click()
    await expect(page).toHaveURL(/#\/exams\/quiz_/)
  })

  test('keeping an inbox item takes it out of New', async ({ page }) => {
    await open(page, '/inbox', 'light')
    const first = page.getByRole('article').first()
    const title = await first.getAttribute('aria-label')
    await first.getByRole('button', { name: 'Keep' }).click()
    await expect(page.getByRole('article', { name: title ?? '' })).toHaveCount(0)
    await page.getByRole('tab', { name: /Kept/ }).click()
    await expect(page.getByRole('article', { name: title ?? '' })).toBeVisible()
  })
})
