/**
 * Earlier roadmap versions on the subject page, in a plain browser against the mock API
 * (?mock=1), light and dark: the quiet "Earlier versions" toggle under Progress opened with one
 * version's steps showing (ui-subject-history-<theme>.png), then after "Bring back"
 * (ui-subject-history-restored-<theme>.png). Starts its own Vite preview server on 5181 (or the
 * next free port).
 *   npx playwright test tests/e2e-sim/subject-history.spec.ts
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = process.env.UI_SCREENS_DIR ?? resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/app/vite.preview.config.mjs')
const WIDTH = 1200
const HEIGHT = 900

type Theme = 'light' | 'dark'

let server: ViteDevServer
let base = ''

const url = (route: string, theme: Theme) =>
  `${base}/app.html?mock=1&latency=0&scenario=demo&theme=${theme}#${route}`

async function shoot(page: Page, file: string, theme: Theme) {
  await page.mouse.move(WIDTH - 2, HEIGHT - 2)
  await page.waitForTimeout(250)
  await page.screenshot({ path: `${SHOTS}/${file}-${theme}.png`, animations: 'disabled' })
}

// No traces: test-results/ is shared, and a parallel run elsewhere can wipe it mid-test.
test.use({ trace: 'off' })

test.beforeAll(async ({ browser }) => {
  test.setTimeout(120_000)
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5181, strictPort: false, hmr: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5181/').replace(/\/$/, '')
  const page = await browser.newPage()
  await page.goto(url('/home', 'light'), { waitUntil: 'networkidle', timeout: 90_000 })
  await page.close()
})

test.afterAll(async () => {
  await server?.close()
})

for (const theme of ['light', 'dark'] as const) {
  test.describe(`subject history · ${theme}`, () => {
    test.use({ colorScheme: theme, viewport: { width: WIDTH, height: HEIGHT } })

    test(`ui-subject-history → restored`, async ({ page }) => {
      const errors: string[] = []
      page.on('pageerror', (err) => errors.push(err.message))
      await page.goto(url('/subjects/sub_orgo/roadmap', theme))
      const progress = page.getByRole('region', { name: 'Progress' })
      await progress.getByRole('button', { name: 'Earlier versions (2)' }).click()
      const list = progress.getByRole('list', { name: 'Earlier versions' })
      await expect(
        list.getByRole('listitem').filter({ hasText: 'Substitution basics' }),
      ).toHaveCount(1)
      await list.getByRole('button', { name: 'Open Substitution basics' }).click()
      await expect(list.getByRole('list', { name: 'Steps of Substitution basics' })).toBeVisible()
      await page.evaluate(() =>
        (
          globalThis as unknown as { document: { fonts: { ready: Promise<unknown> } } }
        ).document.fonts.ready.then(() => undefined),
      )
      await shoot(page, 'ui-subject-history', theme)

      await list.getByRole('button', { name: 'Bring back Substitution basics' }).click()
      await expect(page.getByText(/^Brought back “Substitution basics”/)).toBeVisible()
      await expect(progress.getByText('Step 3 of 6', { exact: false })).toBeVisible()
      await expect(list.getByText('SN1 vs SN2')).toBeVisible()
      await shoot(page, 'ui-subject-history-restored', theme)
      expect(errors).toEqual([])
    })
  })
}
