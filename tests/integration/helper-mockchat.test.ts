/**
 * The mock chat server behaves like the page expects (no browser needed): input mirroring,
 * sending with canned answers, commands for the page, reset and close.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MOCK_CHAT_PLACEHOLDER } from '../../tools/mock-chat/page'
import {
  cannedAnswer,
  type MockChatServer,
  type MockChatState,
  startMockChat,
} from '../../tools/mock-chat/serve'

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

describe('mock chat server', () => {
  it('serves a ChatGPT-like page with the "Ask anything" composer', async () => {
    const html = await fetch(chat.url).then((r) => r.text())
    expect(html).toContain(`aria-placeholder="${MOCK_CHAT_PLACEHOLDER}"`)
    expect(html).toContain('contenteditable="true"')
    expect(html).toContain('aria-label="Send prompt"')
  })

  it('mirrors the composer and appends a canned answer on send', async () => {
    await post('/api/input', { text: 'What is photosynthesis?' })
    expect(chat.state().input).toBe('What is photosynthesis?')
    const state = await post('/api/send', { text: 'What is photosynthesis?' })
    expect(state.sends).toBe(1)
    expect(state.input).toBe('')
    expect(state.messages).toEqual([
      { role: 'user', text: 'What is photosynthesis?' },
      { role: 'assistant', text: cannedAnswer('What is photosynthesis?', 0) },
    ])
    expect(await fetch(`${chat.url}/state`).then((r) => r.json())).toMatchObject({ sends: 1 })
  })

  it('ignores empty sends and hands commands to the page once', async () => {
    await post('/api/send', { text: '   ' })
    expect(chat.state().sends).toBe(0)
    chat.requestClose()
    expect(await fetch(`${chat.url}/api/command`).then((r) => r.json())).toEqual({
      command: 'close',
    })
    expect(await fetch(`${chat.url}/api/command`).then((r) => r.json())).toEqual({ command: null })
    expect(chat.state().pageConnected).toBe(true)
    await post('/api/closed')
    expect(chat.state().closed).toBe(true)
  })

  it('resets', async () => {
    await post('/api/send', { text: 'hello' })
    await post('/api/reset')
    expect(chat.state()).toMatchObject({ messages: [], input: '', sends: 0 })
  })
})
