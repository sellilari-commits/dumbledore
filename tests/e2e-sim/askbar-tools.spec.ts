/**
 * The tool-using chat in the double-tap chat, in a plain browser with the Ask bar's mock driver
 * (no Electron): two receipt rows with Undo (one pressed → Undone), a delete's confirmation chip
 * (pressed → Done), a failed Undo shown quietly, and a web search's sources as links that open
 * only on a click. Screenshots in light and dark to __screenshots__/askbar-tools-<state>-<theme>.png.
 * Starts its own Vite server (port 5193).
 */
import { resolve } from 'node:path'
import { expect, type Page, test } from '@playwright/test'
import { createServer, type ViteDevServer } from 'vite'

const ROOT = resolve(__dirname, '../..')
const SHOTS = resolve(__dirname, '__screenshots__')
const CONFIG = resolve(ROOT, 'src/renderer/surfaces/overlay/vite.config.mjs')

interface PageGlobals {
  __ddMock: { calls: Array<{ channel: string; payload: unknown }> }
}

let server: ViteDevServer
let base = ''

test.beforeAll(async () => {
  server = await createServer({
    configFile: CONFIG,
    logLevel: 'error',
    server: { port: 5193, strictPort: false },
  })
  await server.listen()
  base = (server.resolvedUrls?.local[0] ?? 'http://localhost:5193/').replace(/\/$/, '')
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
    path: `${SHOTS}/askbar-tools-${name}.png`,
    clip: { x: b.x - 48, y: b.y - 40, width: b.width + 96, height: b.height + 96 },
    animations: 'disabled',
  })
}

async function send(page: Page, text: string) {
  await page.getByRole('textbox', { name: 'Ask Dumbledore' }).fill(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('.ask__msg--assistant')).toHaveCount(1)
  await expect(page.locator('.ask__busy')).toHaveCount(0)
}

const RENAME = 'Renamed “Causal graphs” → “DAGs”'
const DELETE = 'Delete note “Colliders open a path when you condition on them”'

for (const theme of ['light', 'dark'] as const) {
  test.describe(`ask bar tools (${theme})`, () => {
    test('receipts: two rows with Undo, one undone', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'rename Causal graphs to DAGs and mark step 3 done')
      const rows = page.getByRole('list', { name: 'What Dumbledore changed' }).getByRole('listitem')
      await expect(rows).toHaveCount(2)
      await expect(page.getByRole('button', { name: /^Undo: / })).toHaveCount(2)
      // Labelled undos are rows, not chips.
      await expect(page.getByRole('button', { name: 'Undo', exact: true })).toHaveCount(0)
      await page.getByRole('button', { name: `Undo: ${RENAME}` }).click()
      await expect(rows.first()).toHaveAttribute('data-state', 'undone')
      await expect(rows.first()).toContainText('Undone')
      await expect(rows.nth(1)).toHaveAttribute('data-state', 'idle')
      expect(await calls(page, 'coach.runAction')).toEqual([
        { type: 'undo_save', saveId: 'undo_rename', label: RENAME },
      ])
      expect(await calls(page, 'window.close')).toEqual([])
      await shoot(page, `receipts-${theme}`)
    })

    test('a delete waits for its confirmation chip', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'delete my colliders note')
      const chip = page.getByRole('button', { name: DELETE })
      await expect(chip).toBeVisible()
      await shoot(page, `confirm-${theme}`)
      await chip.click()
      await chip.click({ timeout: 200 }).catch(() => {}) // a second press while it runs does nothing
      await expect(page.locator('.ask__chip--confirm[data-state="done"]')).toHaveText('Done')
      expect(await calls(page, 'coach.runAction')).toEqual([
        {
          type: 'run_tool',
          tool: 'delete',
          input: { kind: 'note', id: 'note_colliders' },
          label: DELETE,
        },
      ])
      await shoot(page, `confirm-done-${theme}`)
    })

    test('a failed Undo shows quietly in its row', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0&undo=fail`)
      await send(page, 'rename Causal graphs to DAGs and mark step 3 done')
      await page.getByRole('button', { name: `Undo: ${RENAME}` }).click()
      const row = page.locator('.ask__receipt').first()
      await expect(row).toHaveAttribute('data-state', 'failed')
      await expect(row.getByRole('status')).toHaveText('That can no longer be undone.')
      await expect(page.getByRole('alert')).toHaveCount(0)
      await shoot(page, `undo-failed-${theme}`)
    })

    test('web search sources are links', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'look up what a backdoor path is')
      const links = page.locator('.ask__sources a')
      await expect(links).toHaveCount(2)
      await shoot(page, `sources-${theme}`)
    })
  })
}

test('a source link opens only on a click, in a new window, never in the chat', async ({
  page,
  context,
}) => {
  await context.route('https://example.org/**', (route) =>
    route.fulfill({ contentType: 'text/html', body: '<p>source</p>' }),
  )
  const opened: string[] = []
  context.on('page', (p) => opened.push(p.url()))
  await page.goto(`${base}/askbar.html?topics=0`)
  const chatUrl = page.url()
  await send(page, 'look up what a backdoor path is')
  const link = page.locator('.ask__sources a').first()
  await expect(link).toHaveAttribute('target', '_blank')
  await expect(link).toHaveAttribute('href', 'https://example.org/what-if')
  await page.waitForTimeout(300)
  expect(opened).toEqual([])
  const popup = page.waitForEvent('popup')
  await link.click()
  expect((await popup).url()).toBe('https://example.org/what-if')
  expect(page.url()).toBe(chatUrl)
})
