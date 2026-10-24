import type { ChatMessage } from '@shared/domain'
import type { InvokeChannel } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { InvokeHandlers } from '../overlay/lib/localApi'
import { fakeApi } from '../overlay/testing/fakeApi'
import { describeAction } from './ActionChips'
import { AskBar, FOLLOW_UP, PLACEHOLDER } from './AskBar'
import { currentChat, VISIBLE_LIMIT } from './askHistory'
import { clampHeight, heightCap } from './useWindowAutoSize'

const RESULT: AskResult = {
  reply: 'Recursion is **a function calling itself** on a smaller input.\n\n- Base case\n- Step',
  actions: [
    { type: 'start_roadmap', subjectId: null, goal: 'Understand recursion' },
    { type: 'insert_prompt', text: 'Trace factorial(3)' },
  ],
  pasted: false,
}

const msg = (id: string, role: ChatMessage['role'], content: string, createdAt: string) => ({
  id,
  thread: 'ask',
  role,
  content,
  actions: [],
  createdAt,
})

function askApi(
  submit: (text: string) => Promise<AskResult> | AskResult = () => RESULT,
  extra: InvokeHandlers = {},
) {
  return fakeApi(
    {
      'chat.history': () => [],
      'session.picker': () => ({ subjects: [] }),
      'ask.submit': ({ text }) => submit(text),
      'coach.runAction': () => undefined,
      'window.close': () => undefined,
      'window.setSize': () => undefined,
      ...extra,
    },
    'askbar',
  )
}

const input = () => screen.getByRole('textbox', { name: 'Ask Dumbledore' }) as HTMLTextAreaElement
const flush = () => act(async () => {})
const callsTo = (local: ReturnType<typeof askApi>, channel: InvokeChannel) =>
  local.calls.filter((c) => c.channel === channel).map((c) => c.payload)

function ask(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
})

describe('AskBar', () => {
  it('opens focused with the placeholder and reports its size', () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    expect(input().placeholder).toBe(PLACEHOLDER)
    expect(document.activeElement).toBe(input())
    expect(callsTo(local, 'window.setSize')[0]).toEqual({
      surface: 'askbar',
      width: 560,
      height: 52,
    })
  })

  it('Enter → ask.submit, then the markdown reply and action chips', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    ask('  I don’t get recursion ')
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([{ text: 'I don’t get recursion' }])
    expect(screen.getByText('I don’t get recursion')).toBeTruthy()
    expect(screen.getByText('a function calling itself').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Start roadmap: Understand recursion/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paste prompt into chat' })).toBeTruthy()
    expect(input().value).toBe('')
    expect(input().placeholder).toBe(FOLLOW_UP)
  })

  it('keeps a multi-turn conversation, one question at a time', async () => {
    let resolve: (r: AskResult) => void = () => {}
    const replies = ['First answer.', 'Second answer.']
    const local = askApi(() => new Promise<AskResult>((r) => (resolve = r)))
    render(<AskBar api={local.api} />)
    ask('chemistry')
    await flush()
    ask('moles?')
    await flush()
    expect(callsTo(local, 'ask.submit')).toHaveLength(1) // busy: the follow-up waits
    expect(input().value).toBe('moles?')
    await act(async () => resolve({ ...RESULT, reply: replies[0] ?? '' }))
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    await act(async () => resolve({ ...RESULT, reply: replies[1] ?? '', actions: [] }))
    expect(callsTo(local, 'ask.submit')).toEqual([{ text: 'chemistry' }, { text: 'moles?' }])
    const log = screen.getByRole('log', { name: 'Conversation with Dumbledore' })
    expect(log.textContent).toMatch(/chemistry.*First answer\..*moles\?.*Second answer\./)
    expect(screen.getAllByRole('button', { name: 'Paste prompt into chat' })).toHaveLength(1)
  })

  it('Shift+Enter adds a line instead of sending', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    fireEvent.change(input(), { target: { value: 'line one' } })
    fireEvent.keyDown(input(), { key: 'Enter', shiftKey: true })
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([])
  })

  it('ignores an empty question', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    ask('   ')
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([])
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('streams chat.delta text while the reply is written', async () => {
    let resolve: (r: AskResult) => void = () => {}
    const local = askApi(() => new Promise<AskResult>((r) => (resolve = r)))
    render(<AskBar api={local.api} />)
    ask('quiz me now')
    await flush()
    expect(screen.getByText('Thinking…')).toBeTruthy()
    act(() => {
      local.emit('chat.delta', { thread: 'ask', messageId: 'm1', delta: 'Here ', done: false })
      local.emit('chat.delta', { thread: 'other', messageId: 'm2', delta: 'NOPE', done: false })
      local.emit('chat.delta', { thread: 'ask', messageId: 'm3', delta: 'STALE', done: false })
      local.emit('chat.delta', { thread: 'ask', messageId: 'm1', delta: 'we go', done: false })
    })
    expect(screen.getByText('Here we go')).toBeTruthy()
    await act(async () => resolve(RESULT))
    expect(screen.queryByText('Here we go')).toBeNull()
    expect(screen.getByText('a function calling itself')).toBeTruthy()
    // A late delta (e.g. a `/d` line on the same thread) doesn't open a bubble.
    act(() => local.emit('chat.delta', { thread: 'ask', messageId: 'm9', delta: 'x', done: false }))
    expect(screen.queryByText('Thinking…')).toBeNull()
  })

  it('shows the stored conversation, only what came after the last New chat', async () => {
    window.localStorage.setItem('dumbledore.ask.since', '2026-10-24T10:00:00.000Z')
    const stored = [
      msg('a', 'user', 'old question', '2026-10-24T09:00:00.000Z'),
      msg('b', 'assistant', 'old answer', '2026-10-24T09:00:01.000Z'),
      msg('c', 'user', 'new question', '2026-10-24T10:05:00.000Z'),
      msg('d', 'assistant', 'new answer', '2026-10-24T10:05:01.000Z'),
    ]
    const local = askApi(() => RESULT, { 'chat.history': () => stored })
    render(<AskBar api={local.api} />)
    await flush()
    expect(callsTo(local, 'chat.history')).toContain('ask')
    expect(screen.queryByText('old answer')).toBeNull()
    expect(screen.getByText('new answer')).toBeTruthy()
    ask('next')
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([
      { text: 'next', since: '2026-10-24T10:00:00.000Z' },
    ])
  })

  it('New chat clears the conversation and leaves it out of the next question', async () => {
    const stored: ChatMessage[] = []
    const local = askApi(
      (text) => {
        stored.push(
          msg(`u${stored.length}`, 'user', text, new Date(Date.now() - 5000).toISOString()),
        )
        return RESULT
      },
      { 'chat.history': () => stored },
    )
    render(<AskBar api={local.api} />)
    ask('recursion')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(screen.queryByRole('log')).toBeNull()
    expect(input().placeholder).toBe(PLACEHOLDER)
    const since = window.localStorage.getItem('dumbledore.ask.since')
    expect(since).toBeTruthy()
    act(() => {
      window.dispatchEvent(new Event('focus')) // coming back reloads, still filtered
    })
    await flush()
    expect(screen.queryByText('recursion')).toBeNull()
    ask('chemistry')
    await flush()
    expect(callsTo(local, 'ask.submit').at(-1)).toEqual({ text: 'chemistry', since })
  })

  it('⌘N starts a new chat too', async () => {
    render(<AskBar api={askApi().api} />)
    ask('recursion')
    await flush()
    fireEvent.keyDown(window, { key: 'n', metaKey: true })
    expect(screen.queryByRole('log')).toBeNull()
  })

  it('coming back to the window reloads the chat and re-sends its size', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    await flush()
    const before = callsTo(local, 'window.setSize').length
    act(() => {
      window.dispatchEvent(new Event('focus'))
    })
    await flush()
    expect(callsTo(local, 'chat.history').length).toBeGreaterThanOrEqual(2)
    expect(callsTo(local, 'window.setSize').length).toBe(before + 1)
  })

  it('an action chip runs coach.runAction, then closes the bar', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    ask('recursion')
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'Paste prompt into chat' }))
    await flush()
    const channels = local.calls.map((c) => c.channel)
    expect(channels.slice(-2)).toEqual(['coach.runAction', 'window.close'])
    expect(local.calls.at(-2)?.payload).toEqual(RESULT.actions[1])
  })

  it('Esc closes the window', () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    fireEvent.keyDown(input(), { key: 'Escape' })
    expect(callsTo(local, 'window.close')).toEqual(['askbar'])
  })

  it('a failed question goes back into the input with the error', async () => {
    const failing = askApi(() => Promise.reject(new Error('Groq is busy')))
    render(<AskBar api={failing.api} />)
    ask('help')
    await flush()
    expect(screen.getByRole('alert').textContent).toBe('Groq is busy. Press ↵ to try again.')
    expect(input().value).toBe('help')
    fireEvent.change(input(), { target: { value: '' } })
    expect(screen.queryByRole('alert')).toBeNull()
  })

  it('shows the pasted note', async () => {
    render(<AskBar api={askApi(() => ({ ...RESULT, pasted: true })).api} />)
    ask('help')
    await flush()
    expect(screen.getByText('Pasted into the chat box')).toBeTruthy()
  })
})

describe('Ask bar helpers', () => {
  it('labels every coach action', () => {
    expect(describeAction({ type: 'start_review', conceptIds: ['a', 'b'] }).label).toBe(
      'Review 2 concepts',
    )
    expect(
      describeAction({
        type: 'create_exam',
        spec: { subjectIds: ['s'], count: 10, focus: 'weak', difficulty: 'mixed' },
      }).label,
    ).toBe('Create a 10-question exam')
    expect(describeAction({ type: 'set_focus', subjectId: null }).label).toBe('Clear focus')
    expect(describeAction({ type: 'open_subject', subjectId: 's' }).label).toBe('Open subject')
  })

  it('keeps the window between 52 and 600 tall, less on a short screen', () => {
    expect(clampHeight(0)).toBe(52)
    expect(clampHeight(300.2)).toBe(301)
    expect(clampHeight(2000)).toBe(600)
    expect(heightCap()).toBe(600)
    expect(heightCap(500)).toBe(484)
    expect(clampHeight(2000, heightCap(500))).toBe(484)
  })

  it('shows the newest messages after the reset', () => {
    const many = Array.from({ length: VISIBLE_LIMIT + 5 }, (_, i) =>
      msg(`m${i}`, 'user', String(i), new Date(Date.UTC(2026, 9, 24, 10, i)).toISOString()),
    )
    expect(currentChat(many, null)).toHaveLength(VISIBLE_LIMIT)
    expect(currentChat(many, null)[0]?.id).toBe('m5')
    expect(currentChat(many, '2026-10-24T11:00:00.000Z').map((m) => m.id)).toEqual([
      'm61',
      'm62',
      'm63',
      'm64',
    ])
    expect(currentChat(many, 'garbage')).toHaveLength(VISIBLE_LIMIT)
  })
})
