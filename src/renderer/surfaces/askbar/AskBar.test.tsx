import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../overlay/testing/fakeApi'
import { describeAction } from './ActionChips'
import { AskBar, PLACEHOLDER } from './AskBar'
import { clampHeight } from './useWindowAutoSize'

const RESULT: AskResult = {
  reply: 'Recursion is **a function calling itself** on a smaller input.\n\n- Base case\n- Step',
  actions: [
    { type: 'start_roadmap', subjectId: null, goal: 'Understand recursion' },
    { type: 'insert_prompt', text: 'Trace factorial(3)' },
  ],
  pasted: false,
}

function askApi(submit: (text: string) => Promise<AskResult> | AskResult = () => RESULT) {
  return fakeApi(
    {
      'ask.submit': ({ text }) => submit(text),
      'coach.runAction': () => undefined,
      'window.close': () => undefined,
      'window.setSize': () => undefined,
    },
    'askbar',
  )
}

const input = () => screen.getByRole('textbox', { name: 'Ask Dumbledore' }) as HTMLInputElement
const flush = () => act(async () => {})

function ask(text: string) {
  fireEvent.change(input(), { target: { value: text } })
  fireEvent.keyDown(input(), { key: 'Enter' })
}

afterEach(cleanup)

describe('AskBar', () => {
  it('opens focused with the placeholder and reports its size', () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    expect(input().placeholder).toBe(PLACEHOLDER)
    expect(document.activeElement).toBe(input())
    expect(local.calls.find((c) => c.channel === 'window.setSize')?.payload).toEqual({
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
    expect(local.calls.find((c) => c.channel === 'ask.submit')?.payload).toEqual({
      text: 'I don’t get recursion',
    })
    expect(screen.getByText('a function calling itself').tagName).toBe('STRONG')
    expect(screen.getAllByRole('listitem')).toHaveLength(2)
    expect(screen.getByRole('button', { name: /Start roadmap: Understand recursion/ })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Paste prompt into chat' })).toBeTruthy()
  })

  it('ignores an empty question', async () => {
    const local = askApi()
    render(<AskBar api={local.api} />)
    ask('   ')
    await flush()
    expect(local.calls.some((c) => c.channel === 'ask.submit')).toBe(false)
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
      local.emit('chat.delta', { thread: 'ask', messageId: 'm1', delta: 'we go', done: false })
    })
    expect(screen.getByText('Here we go')).toBeTruthy()
    await act(async () => resolve(RESULT))
    expect(screen.queryByText('Here we go')).toBeNull()
    expect(screen.getByText('a function calling itself')).toBeTruthy()
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
    expect(local.calls.find((c) => c.channel === 'window.close')?.payload).toBe('askbar')
  })

  it('shows errors and the pasted note', async () => {
    const failing = askApi(() => Promise.reject(new Error('Groq is busy')))
    render(<AskBar api={failing.api} />)
    ask('help')
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('Groq is busy')
    cleanup()
    render(<AskBar api={askApi(() => ({ ...RESULT, pasted: true })).api} />)
    ask('help')
    await flush()
    expect(screen.getByText('Pasted into the chat box')).toBeTruthy()
  })

  it('clearing the question collapses the answer', async () => {
    render(<AskBar api={askApi().api} />)
    ask('recursion')
    await flush()
    fireEvent.change(input(), { target: { value: '' } })
    expect(screen.queryByText('a function calling itself')).toBeNull()
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

  it('keeps the window between 52 and 560 tall', () => {
    expect(clampHeight(0)).toBe(52)
    expect(clampHeight(300.2)).toBe(301)
    expect(clampHeight(2000)).toBe(560)
  })
})
