import { demoAppState } from '@renderer/lib/mock/demo-misc'
import type { InvokeChannel } from '@shared/ipc'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { InvokeHandlers } from '../overlay/lib/localApi'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar, PLACEHOLDER, PROMPT_PLACEHOLDER } from './AskBar'
import { isPromptRoute, promptHint } from './usePromptBox'

function promptApi(extra: InvokeHandlers = {}, aiChat: string | null = 'ChatGPT') {
  return fakeApi(
    {
      'chat.history': () => [],
      'ask.submit': () => ({ reply: 'Hi.', actions: [], pasted: false }),
      'app.getState': () => ({
        ...demoAppState(true),
        aiChat: aiChat ? { provider: aiChat } : null,
      }),
      'prompt.write': ({ context }) => ({ pasted: true, prompt: `Better: ${context}` }),
      'window.close': () => undefined,
      'window.setSize': () => undefined,
      ...extra,
    },
    'askbar',
  )
}

const box = () =>
  screen.getByRole('textbox', { name: 'Open a topic' }) as HTMLTextAreaElement
const flush = () => act(async () => {})
const callsTo = (local: ReturnType<typeof promptApi>, channel: InvokeChannel) =>
  local.calls.filter((c) => c.channel === channel).map((c) => c.payload)

function wish(text: string) {
  fireEvent.change(box(), { target: { value: text } })
  fireEvent.keyDown(box(), { key: 'Enter' })
}

beforeEach(() => {
  window.location.hash = '#/prompt'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
  window.localStorage.clear()
})

describe('Ask bar prompt box (route prompt, right ⌥ hold)', () => {
  it('shows one calm input and the AI chat the prompt goes into; no subject list', async () => {
    const local = promptApi()
    render(<AskBar api={local.api} />)
    await flush()
    expect(box().placeholder).toBe(PROMPT_PLACEHOLDER)
    expect(screen.getByText(promptHint('ChatGPT'))).toBeTruthy()
    expect(document.querySelector('.ask__choices')).toBeNull()
    expect(callsTo(local, 'session.picker')).toEqual([])
    // The compact study box, clearly not the tall chat: no header, the 560-wide bar layout.
    expect(screen.queryByRole('heading')).toBeNull()
    expect(document.querySelector('.ask')?.getAttribute('data-layout')).toBe('bar')
    expect(callsTo(local, 'window.setSize').at(-1)).toMatchObject({ width: 560 })
  })

  it('says the prompt is copied when no AI chat is open', async () => {
    render(<AskBar api={promptApi({}, null).api} />)
    await flush()
    expect(screen.getByText(/No AI chat is open/)).toBeTruthy()
  })

  it('↵ sends the wish as prompt.write, shows thinking, then leaves the mode', async () => {
    let finish: () => void = () => undefined
    const local = promptApi({
      'prompt.write': ({ context }) =>
        new Promise((resolve) => {
          finish = () => resolve({ pasted: true, prompt: `Better: ${context}` })
        }),
    })
    render(<AskBar api={local.api} />)
    await flush()
    wish('explain SN1 simply, I have an exam Friday')
    await flush()
    expect(callsTo(local, 'prompt.write')).toEqual([
      { context: 'explain SN1 simply, I have an exam Friday' },
    ])
    expect(callsTo(local, 'ask.submit')).toEqual([])
    expect(screen.getByRole('status', { name: 'Building your roadmap' })).toBeTruthy()
    expect(screen.getByText('Building your roadmap…')).toBeTruthy()
    expect(box().readOnly).toBe(true)
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(callsTo(local, 'prompt.write')).toHaveLength(1)
    await act(async () => finish())
    const chat = screen.getByRole('textbox', { name: 'Ask Dumbledore' }) as HTMLTextAreaElement
    expect(chat.placeholder).toBe(PLACEHOLDER)
    expect(chat.value).toBe('')
  })

  it('shows an error line and keeps the text when writing fails', async () => {
    const local = promptApi({
      'prompt.write': () => {
        throw new Error('No AI provider is set up')
      },
    })
    render(<AskBar api={local.api} />)
    await flush()
    wish('quiz me on SN2')
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('No AI provider is set up')
    expect(box().value).toBe('quiz me on SN2')
    expect(box().readOnly).toBe(false)
    fireEvent.change(box(), { target: { value: 'quiz me on SN2, 5 questions' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('an empty ↵ does nothing; Esc closes; blur ends the mode; navigate starts it again', async () => {
    const local = promptApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.keyDown(box(), { key: 'Enter' })
    expect(callsTo(local, 'prompt.write')).toEqual([])
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callsTo(local, 'window.close')).toEqual(['askbar'])
    expect(screen.getByRole('textbox', { name: 'Ask Dumbledore' })).toBeTruthy()
    act(() => local.emit('navigate', { route: 'prompt' }))
    await flush()
    expect(box()).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(screen.getByRole('textbox', { name: 'Ask Dumbledore' })).toBeTruthy()
  })
})

describe('prompt route', () => {
  it('recognises the route in its forms', () => {
    expect(isPromptRoute('prompt')).toBe(true)
    expect(isPromptRoute('/prompt')).toBe(true)
    expect(isPromptRoute('#/prompt')).toBe(true)
    expect(isPromptRoute('choose')).toBe(false)
    expect(isPromptRoute(null)).toBe(false)
  })
})
