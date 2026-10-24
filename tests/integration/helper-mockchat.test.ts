/**
 * The mock chat used by E2E checks (tools/mock-chat): the server API on its own, then the real page
 * in headless Chromium (Playwright's bundled browser; those tests skip when it is not installed) —
 * typing, Shift+Enter, sending, edits without an input event (as Accessibility insertion does) and
 * the test commands.
 */
import { type Browser, chromium, type Page } from '@playwright/test'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { MOCK_CHAT_PLACEHOLDER, MOCK_CHAT_TITLE } from '../../tools/mock-chat/page'
import {
  cannedAnswer,
  type MockChatServer,
  type MockChatState,
  startMockChat,
} from '../../tools/mock-chat/server'

let chat: MockChatServer

beforeEach(async () => {
  chat = await startMockChat({ port: 0 })
})

afterEach(async () => {
  await chat.close()
})

const post = (path: string, body: unknown = {}): Promise<MockChatState> =>
  fetch(`${chat.url}${path}`, { method: 'POST', body: JSON.stringify(body) }).then(
    (r) => r.json() as Promise<MockChatState>,
  )
const command = (): Promise<unknown> => fetch(`${chat.url}/api/command`).then((r) => r.json())

async function until(cond: (s: MockChatState) => boolean, ms = 4000): Promise<MockChatState> {
  const end = Date.now() + ms
  for (;;) {
    const s = chat.state()
    if (cond(s)) return s
    if (Date.now() > end) throw new Error(`mock chat state not reached: ${JSON.stringify(s)}`)
    await new Promise((r) => setTimeout(r, 25))
  }
}

describe('mock chat server', () => {
  it('serves a ChatGPT-like page with the "Ask anything" composer', async () => {
    const html = await fetch(chat.url).then((r) => r.text())
    expect(html).toContain(`<title>${MOCK_CHAT_TITLE}</title>`)
    expect(html).toContain(`aria-placeholder="${MOCK_CHAT_PLACEHOLDER}"`)
    expect(html).toContain('contenteditable="true"')
    expect(html).toContain('aria-label="Send prompt"')
  })

  it('mirrors the composer and appends a canned answer on send', async () => {
    await post('/api/input', { text: 'What is photosynthesis?' })
    expect(chat.state()).toMatchObject({ input: 'What is photosynthesis?', inputUpdates: 1 })
    const state = await post('/api/send', { text: 'What is photosynthesis?' })
    expect(state.sends).toBe(1)
    expect(state.input).toBe('')
    expect(state.messages).toEqual([
      { role: 'user', text: 'What is photosynthesis?' },
      { role: 'assistant', text: cannedAnswer('What is photosynthesis?', 0) },
    ])
    expect(await fetch(`${chat.url}/state`).then((r) => r.json())).toMatchObject({ sends: 1 })
  })

  it('ignores empty sends and queues commands for the page in order', async () => {
    await post('/api/send', { text: '   ' })
    expect(chat.state().sends).toBe(0)
    chat.requestFocus()
    chat.requestClose()
    expect(await command()).toEqual({ command: 'focus' })
    expect(await command()).toEqual({ command: 'close' })
    expect(await command()).toEqual({ command: null })
    expect(chat.state().pageConnected).toBe(true)
    await post('/api/closed')
    expect(chat.state().closed).toBe(true)
  })

  it('drops stale commands when the page loads', async () => {
    chat.requestClose()
    await fetch(chat.url).then((r) => r.text())
    expect(await command()).toEqual({ command: null })
  })

  it('resets', async () => {
    await post('/api/send', { text: 'hello' })
    await post('/api/reset')
    expect(chat.state()).toMatchObject({ messages: [], input: '', sends: 0 })
    expect(await command()).toEqual({ command: 'reset' })
  })
})

let browser: Browser | null = null
try {
  browser = await chromium.launch({ headless: true })
} catch {
  browser = null // Playwright's Chromium is not installed: `npx playwright install chromium`
}

describe.skipIf(!browser)('mock chat page (headless Chromium)', () => {
  let page: Page

  beforeAll(() => {
    expect(browser).not.toBeNull()
  })

  afterAll(async () => {
    await browser?.close()
  })

  beforeEach(async () => {
    page = await (browser as Browser).newPage()
    await page.goto(chat.url)
    await until((s) => s.pageConnected)
  })

  afterEach(async () => {
    await page.close()
  })

  // Page code is passed as strings: the node tsconfig has no DOM types.
  const inPage = <T>(expression: string): Promise<T> => page.evaluate(expression) as Promise<T>
  const composer = "document.getElementById('prompt-textarea')"
  const placeholder = () => inPage<string>(`getComputedStyle(${composer}, '::before').content`)

  it('shows the placeholder and a disabled send button while empty', async () => {
    expect(await placeholder()).toBe(`"${MOCK_CHAT_PLACEHOLDER}"`)
    expect(await page.isDisabled('#send')).toBe(true)
    expect(await inPage('document.activeElement?.id')).toBe('prompt-textarea')
  })

  it('reports typing (with Shift+Enter newlines) and sends on Enter', async () => {
    await page.click('#prompt-textarea')
    await page.keyboard.type('Explain osmosis')
    await page.keyboard.press('Shift+Enter')
    await page.keyboard.type('in two lines')
    await until((s) => s.input === 'Explain osmosis\nin two lines')
    expect(await placeholder()).toBe('none')
    expect(await page.isDisabled('#send')).toBe(false)

    await page.keyboard.press('Enter')
    const s = await until((x) => x.sends === 1 && x.input === '')
    expect(s.messages[0]).toEqual({ role: 'user', text: 'Explain osmosis\nin two lines' })
    await page.waitForSelector('.msg.assistant p:not(.typing)')
    expect(await page.textContent('#messages')).toContain(
      'You asked: “Explain osmosis in two lines”',
    )
    expect(await page.textContent('#prompt-textarea')).toBe('')
  })

  it('reports edits that fire no input event (like Accessibility insertion)', async () => {
    await inPage(`${composer}.textContent = 'Inserted by the helper'`)
    await until((s) => s.input === 'Inserted by the helper')
    await inPage(
      `${composer}.focus(); document.execCommand('selectAll');` +
        `document.execCommand('insertText', false, 'Pasted prompt ✓ ä ö å')`,
    )
    await until((s) => s.input === 'Pasted prompt ✓ ä ö å')
  })

  it('obeys reset, focus and close commands', async () => {
    await page.keyboard.type('draft')
    await page.click('#send')
    await until((s) => s.sends === 1)
    await page.waitForSelector('.msg.user')
    chat.reset()
    await page.waitForFunction("document.querySelectorAll('.msg').length === 0")
    await inPage('document.activeElement?.blur()')
    chat.requestFocus()
    await page.waitForFunction("document.activeElement?.id === 'prompt-textarea'")
    chat.requestClose()
    await until((s) => s.closed)
  })
})
