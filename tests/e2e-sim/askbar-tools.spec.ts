/**
 * The tool-using chat in the double-tap chat, in a plain browser with the Ask bar's mock driver
 * (no Electron). No chips or buttons under a reply, only receipt rows: two rows with Undo (one
 * pressed → Undone), a delete asked as a plain question and done on a typed "yes", the graph
 * neural networks question answered "new course", a prompt with no AI chat open (opened and
 * pasted, a row without Undo), a failed Undo shown quietly, and a web search's sources as links
 * that open only on a click. Screenshots in light and dark to __screenshots__/askbar-tools-<state>-<theme>.png.
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

async function send(page: Page, text: string, replies = 1) {
  await page.getByRole('textbox', { name: /Ask Dumbledore|Reply to Dumbledore/ }).fill(text)
  await page.keyboard.press('Enter')
  await expect(page.locator('.ask__msg--assistant')).toHaveCount(replies)
  await expect(page.locator('.ask__busy')).toHaveCount(0)
}

/** The only buttons under replies are receipt Undos. */
async function onlyUndoButtons(page: Page) {
  const names = await page
    .locator('.ask__msg--assistant button')
    .evaluateAll((els) => els.map((el) => el.getAttribute('aria-label') ?? el.textContent ?? ''))
  for (const name of names) expect(name).toMatch(/^Undo: /)
  await expect(page.locator('.ask__chip')).toHaveCount(0)
}

const RENAME = 'Renamed “Causal graphs” → “DAGs”'
const NOTE = 'Colliders open a path when you condition on them'
const DELETE_QUESTION = `Delete the note “${NOTE}” from Statistics? Say yes to delete it.`
const COURSE_QUESTION =
  'Add Graph Neural Networks to your Neural Networks course, or make it a new course?'

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

    test('a delete is a plain question, done on a typed yes', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'delete my colliders note')
      await expect(page.locator('.ask__msg--assistant').last()).toHaveText(DELETE_QUESTION)
      await expect(page.locator('.ask__receipt')).toHaveCount(0)
      await onlyUndoButtons(page)
      await shoot(page, `confirm-${theme}`)
      await send(page, 'yes', 2)
      const row = page.locator('.ask__receipt')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText(`Deleted note “${NOTE}”`)
      await expect(page.getByRole('button', { name: `Undo: Deleted note “${NOTE}”` })).toBeVisible()
      await onlyUndoButtons(page)
      expect(await calls(page, 'coach.runAction')).toEqual([])
      await shoot(page, `confirm-done-${theme}`)
    })

    test('an unclear course: one clear question, "new course" plans it', async ({ page }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'create me a course on graph neural networks')
      await expect(page.locator('.ask__msg--assistant').last()).toHaveText(COURSE_QUESTION)
      await send(page, 'new course', 2)
      const row = page.locator('.ask__receipt')
      await expect(row).toHaveCount(1)
      await expect(row).toContainText('Planning a roadmap for “Graph Neural Networks”')
      // A receipt without Undo is a plain row.
      await expect(row.getByRole('button')).toHaveCount(0)
      await onlyUndoButtons(page)
      await shoot(page, `course-${theme}`)
    })

    test('a prompt with no AI chat open: opened and pasted, a row without Undo', async ({
      page,
    }) => {
      await page.goto(`${base}/askbar.html?theme=${theme}&topics=0`)
      await send(page, 'write me a prompt that explains backdoor paths')
      const row = page.locator('.ask__receipt')
      await expect(row).toHaveText('Opened ChatGPT and pasted')
      await expect(row.getByRole('button')).toHaveCount(0)
      await onlyUndoButtons(page)
      await shoot(page, `prompt-open-${theme}`)
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
