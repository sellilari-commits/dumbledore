/**
 * The chat's working indicator in a plain browser with the Ask bar's mock driver (no Electron):
 * `?work=` plays a tool loop as 'chat.progress' before the reply. From Enter the dots and
 * "Thinking…" stand where the reply will appear, then the steps follow ("Reading your roadmap…",
 * "Searching the web…"), and the reply replaces them. Screenshots in light and dark to
 * __screenshots__/askbar-working-search-<theme>.png. Starts its own Vite server (port 5194).
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/overlay/vite.config.mjs')
const STEP_MS = 1500

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5194, strictPort: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5194/').replace(/\/$/, '')
})

test.afterAll(async () => {
  await server?.close()
})

test.use({ viewport: { width: 1280, height: 900 } })

/** The card with a margin; animations run, so the dots are caught mid-pulse. */
async function shoot(page: Page, name: string) {
  const b = await page.locator('.ask').boundingBox()
  if (!b) throw new Error('no ask bar')
  await page.screenshot({
    path: `${SHOTS}/askbar-working-${name}.png`,
    clip: { x: b.x - 48, y: b.y - 40, width: b.width + 96, height: b.height + 96 },
  })
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Ask Dumbledore' }).fill(text)
  await page.keyboard.press('Enter')
}

const working = (page: Page) => page.locator('.ask__working')

for (const theme of ['light', 'dark'] as const) {
  test(`working indicator from Enter to the reply (${theme})`, async ({ page }) => {
    await page.goto(`${base}/askbar.html?theme=${theme}&topics=0&seed=2&work=${STEP_MS}`)
    await send(page, 'what’s next on my roadmap? anything new on moles online?')
    await expect(working(page)).toHaveText('Thinking…')
    await expect(working(page).locator('.ask__dots > span')).toHaveCount(3)
    await expect(working(page)).toHaveText('Reading your roadmap…')
    await expect(working(page)).toHaveText('Searching the web…')
    await page.waitForTimeout(400)
    await shoot(page, `search-${theme}`)
    await expect(working(page)).toHaveText('Updating your notes…')
    // The reply takes its place.
    await expect(working(page)).toHaveCount(0, { timeout: 10_000 })
    await expect(page.locator('.ask__msg--assistant')).toHaveCount(3)
    await expect(page.locator('.ask__busy')).toHaveCount(0)
  })
}
