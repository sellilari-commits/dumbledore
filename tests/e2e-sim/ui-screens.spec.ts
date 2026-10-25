/**
 * Every app route in a plain browser against the mock API (?mock=1), light and dark: full-length
 * screenshots to __screenshots__/route-<route>-<theme>.png for design review, plus the exam flow
 * (empty list, New exam dialog, "writing" state, taking with feedback, the "ChatGPT isn't
 * open" choice) as
 * ui-exams-<state>-<theme>.png. Page lanes own ui-<page>-* for their own specs; this spec never
 * writes those. A route fails softly when it crashes (error boundary, not-found page or an
 * uncaught error) — the screenshot is still written. Starts its own Vite preview server on 5180
 * (or the next free port).
 *   npx playwright test tests/e2e-sim/ui-screens.spec.ts [--grep 'route-|ui-exams-']
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
/** UI_SCREENS_DIR redirects the pictures, e.g. to a scratch folder while page owners work. */
const SHOTS = process.env.UI_SCREENS_DIR ?? resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/app/vite.preview.config.mjs')

/** Demo ids from src/renderer/lib/mock (scenario "demo"). */
const SUBJECT = 'sub_orgo'
const EXAM_DONE = 'quiz_orgo_weak'
const EXAM_READY = 'quiz_linalg_ready'
const SETTINGS = ['general', 'capture', 'orb', 'shortcuts', 'ai', 'coaching', 'data', 'about']

const WIDTH = 1200
const HEIGHT = 800
/** Tallest full-length capture; longer pages are cut here. */
const MAX_HEIGHT = 3600

type Theme = 'light' | 'dark'
type Scenario = 'demo' | 'empty' | 'onboarding'

interface Shot {
  name: string
  route: string
  scenario?: Scenario
}

const ROUTES: readonly Shot[] = [
  { name: 'home', route: '/home' },
  { name: 'inbox', route: '/inbox' },
  { name: 'exams-list', route: '/exams' },
  { name: 'exams-results', route: `/exams/${EXAM_DONE}` },
  { name: 'subject', route: `/subjects/${SUBJECT}/roadmap` },
  { name: 'subject-suggested', route: '/subjects/sub_geo/roadmap' },
  ...SETTINGS.map((s) => ({ name: `settings-${s}`, route: `/settings/${s}` })),
  { name: 'onboarding', route: '/onboarding', scenario: 'onboarding' },
  { name: 'onboarding-how', route: '/onboarding?step=how', scenario: 'onboarding' },
  { name: 'home-first-day', route: '/home', scenario: 'empty' },
]

/**
 * The page globals the evaluate() callbacks use. This project has no DOM lib for tests, so the
 * callbacks reach them through `globalThis as unknown as PageGlobals` (a type-only cast).
 */
interface El {
  scrollHeight: number
  clientHeight: number
}
interface PageGlobals {
  document: {
    querySelector: (selector: string) => El | null
    querySelectorAll: (selector: string) => Iterable<El>
    fonts: { ready: Promise<unknown> }
  }
  getComputedStyle: (el: El) => { overflowY: string }
}

let server: ViteDevServer
let base = ''

/** A route may carry page query params after a `?` (e.g. onboarding's `?step=`). */
const url = (route: string, theme: Theme, scenario: Scenario = 'demo') => {
  const [path, query] = route.split('?')
  const extra = query ? `&${query}` : ''
  return `${base}/app.html?mock=1&latency=0&scenario=${scenario}&theme=${theme}${extra}#${path}`
}

/** Waits until skeletons are gone (or 6 s pass — some states keep one on purpose). */
async function settle(page: Page) {
  await page.locator('#root > *').first().waitFor()
  await page
    .waitForFunction(
      () =>
        !(globalThis as unknown as PageGlobals).document.querySelector('.dd-loading, .dd-skeleton'),
      undefined,
      { timeout: 6000 },
    )
    .catch(() => undefined)
  await page.evaluate(() =>
    (globalThis as unknown as PageGlobals).document.fonts.ready.then(() => undefined),
  )
  await page.waitForTimeout(250)
}

async function open(page: Page, shot: Shot, theme: Theme) {
  await page.goto(url(shot.route, theme, shot.scenario))
  await settle(page)
}

/** How much taller the window must be for the longest scroll area to show in full. */
function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const g = globalThis as unknown as PageGlobals
    let most = 0
    for (const el of g.document.querySelectorAll('body *')) {
      const extra = el.scrollHeight - el.clientHeight
      if (extra <= 1) continue
      const { overflowY } = g.getComputedStyle(el)
      if (overflowY === 'auto' || overflowY === 'scroll') most = Math.max(most, extra)
    }
    return most
  })
}

/** <file>-<theme>.png; `full` grows the window so the whole page column is in the picture. */
async function shoot(page: Page, file: string, theme: Theme, full = true) {
  await page.mouse.move(WIDTH - 2, HEIGHT - 2)
  if (full) {
    const extra = await overflow(page)
    if (extra > 0) {
      await page.setViewportSize({ width: WIDTH, height: Math.min(HEIGHT + extra, MAX_HEIGHT) })
      await page.waitForTimeout(200)
    }
  }
  await page.screenshot({ path: `${SHOTS}/${file}-${theme}.png`, animations: 'disabled' })
}

/** Collects uncaught page errors from the moment it is called. */
function watchErrors(page: Page): string[] {
  const errors: string[] = []
  page.on('pageerror', (err) => errors.push(err.message))
  return errors
}

async function expectHealthy(page: Page, errors: string[]) {
  await expect.soft(page.getByText('This page hit a snag'), 'error boundary').toHaveCount(0)
  await expect.soft(page.getByText('This page doesn’t exist'), 'unknown route').toHaveCount(0)
  expect.soft(errors, 'uncaught errors').toEqual([])
}

// No traces: test-results/ is shared, and a parallel run elsewhere can wipe it mid-test.
test.use({ trace: 'off' })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5180, strictPort: false, hmr: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5180/').replace(/\/$/, '')
  // Warm up: the first visit transforms and pre-bundles everything; keep that out of the tests.
  const page = await browser.newPage()
  await page.goto(url('/home', 'light'), { waitUntil: 'networkidle', timeout: 90_000 })
  await page.close()
})

test.afterAll(async () => {
  await server?.close()
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`app screens · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: WIDTH, height: HEIGHT } })

    for (const shot of ROUTES) {
      test(`route-${shot.name}`, async ({ page }) => {
        const errors = watchErrors(page)
        await open(page, shot, theme)
        await shoot(page, `route-${shot.name}`, theme)
        await expectHealthy(page, errors)
      })
    }

    test('ui-exams-empty', async ({ page }) => {
      const errors = watchErrors(page)
      await open(page, { name: 'exams-empty', route: '/exams', scenario: 'empty' }, theme)
      await expect(page.getByText('No exams yet')).toBeVisible()
      await shoot(page, 'ui-exams-empty', theme)
      await expectHealthy(page, errors)
    })

    test('ui-exams-new → ui-exams-writing', async ({ page }) => {
      const errors = watchErrors(page)
      await open(page, { name: 'exams-list', route: '/exams' }, theme)
      await page
        .getByRole('button', { name: /New exam/ })
        .first()
        .click()
      const dialog = page.getByRole('dialog')
      await expect(dialog.getByRole('checkbox', { name: /Organic Chemistry/ })).toBeChecked()
      await page.waitForTimeout(250)
      await shoot(page, 'ui-exams-new', theme, false)

      await dialog.getByRole('button', { name: 'Create exam' }).click()
      await expect(page.getByText(/^Writing \d+ questions on Organic Chemistry…$/)).toBeVisible()
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await shoot(page, 'ui-exams-writing', theme, false)
      await expect(page.getByText(/^0 of \d+ answered$/)).toBeVisible({ timeout: 5000 })
      await expectHealthy(page, errors)
    })

    test('ui-exams-no-chat', async ({ page }) => {
      const errors = watchErrors(page)
      await open(page, { name: 'exams-no-chat', route: `/exams/${EXAM_DONE}?chat=0` }, theme)
      await page.getByRole('button', { name: 'Explore with ChatGPT' }).click()
      const choice = page.getByRole('group', { name: 'No AI chat open' })
      await expect(choice.getByText('ChatGPT isn’t open.')).toBeVisible()
      await expect(choice.getByRole('button', { name: 'Open ChatGPT and paste' })).toBeVisible()
      await choice.scrollIntoViewIfNeeded()
      await page.waitForTimeout(250)
      await shoot(page, 'ui-exams-no-chat', theme, false)
      await expectHealthy(page, errors)
    })

    test('ui-exams-taking', async ({ page }) => {
      const errors = watchErrors(page)
      await open(page, { name: 'exams-taking', route: `/exams/${EXAM_READY}` }, theme)
      await page.getByRole('radio', { name: /^v is an eigenvector with eigenvalue 3/ }).click()
      await expect(page.getByText('Correct.')).toBeVisible()
      await page.getByRole('radio', { name: /^0 and 7/ }).click()
      await expect(page.getByText('Not quite.')).toBeVisible()
      await expect(page.getByText('2 of 5 answered')).toBeVisible()
      await shoot(page, 'ui-exams-taking', theme)
      await expectHealthy(page, errors)
    })
  })
}

test('the new-subject icon picker opens above the dialog', async ({ page }) => {
  await page.goto(url('/home', 'light', 'empty'))
  await page.getByRole('button', { name: 'Add a subject' }).click()
  await page.getByRole('button', { name: /^Icon .*, change$/ }).click()
  // A real click: it fails if the dialog's backdrop covers the picker.
  await page.getByRole('button', { name: 'Use 🧪' }).click()
  await expect(page.getByRole('button', { name: 'Icon 🧪, change' })).toBeVisible()
})
