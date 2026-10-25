/**
 * The working indicator: from Enter until the reply (or an error) it stands where the reply will
 * appear, with pulsing dots and the current step from 'chat.progress' (each held HOLD_MS); words
 * streaming in replace it, and it comes back under them while a tool runs.
 */
import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar } from './AskBar'
import { HOLD_MS } from './Working'

const RESULT: AskResult = { reply: 'Step 3 is next: **Molar mass**.', actions: [], pasted: false }

function setup(submit: () => Promise<AskResult>) {
  const local = fakeApi(
    {
      'chat.history': () => [],
      'subjects.list': () => [],
      'ask.submit': submit,
      'coach.runAction': () => undefined,
      'window.close': () => undefined,
      'window.setSize': () => undefined,
    },
    'askbar',
  )
  render(<AskBar api={local.api} />)
  return local
}

function ask(text: string) {
  const box = screen.getByRole('textbox', { name: 'Ask Dumbledore' })
  fireEvent.change(box, { target: { value: text } })
  fireEvent.keyDown(box, { key: 'Enter' })
}

const indicator = () => document.querySelector('.ask__working')
const step = () => indicator()?.querySelector('.ask__step')?.textContent ?? null
const flush = () => act(async () => {})
const wait = (ms: number) => act(async () => void vi.advanceTimersByTime(ms))

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  cleanup()
  vi.useRealTimers()
  window.localStorage.clear()
})

describe('Ask bar working indicator', () => {
  it('shows from submit to reply, following the tool loop’s steps', async () => {
    let resolve: (r: AskResult) => void = () => {}
    const local = setup(() => new Promise<AskResult>((r) => (resolve = r)))
    expect(indicator()).toBeNull()
    ask('what is next on my roadmap?')
    await flush()

    // Enter: dots + "Thinking…" where the reply will appear, in the polite live bubble.
    expect(indicator()?.textContent).toBe('Thinking…')
    expect(indicator()?.closest('[aria-live="polite"]')).toBeTruthy()
    expect(indicator()?.querySelectorAll('.ask__dots > span')).toHaveLength(3)
    expect(indicator()?.closest('.ask__msg--assistant')).toBeTruthy()

    act(() => {
      local.emit('chat.progress', {
        thread: 'ask',
        messageId: 'm1',
        label: 'Reading your roadmap…',
      })
      // Another thread and another reply's id are not this reply's steps.
      local.emit('chat.progress', { thread: 'other', messageId: 'm1', label: 'NOPE' })
      local.emit('chat.progress', { thread: 'ask', messageId: 'm2', label: 'STALE' })
    })
    // "Thinking…" stays up HOLD_MS before the first step replaces it.
    expect(step()).toBe('Thinking…')
    await wait(HOLD_MS)
    expect(step()).toBe('Reading your roadmap…')

    // Quick steps don't flicker past: the newest waiting one comes next.
    act(() => {
      local.emit('chat.progress', { thread: 'ask', messageId: 'm1', label: 'Thinking…' })
      local.emit('chat.progress', { thread: 'ask', messageId: 'm1', label: 'Searching the web…' })
    })
    await wait(HOLD_MS / 2)
    expect(step()).toBe('Reading your roadmap…')
    await wait(HOLD_MS / 2)
    expect(step()).toBe('Searching the web…')

    // Words stream in: they take its place.
    act(() => {
      local.emit('chat.delta', { thread: 'ask', messageId: 'm1', delta: 'Step 3 ', done: false })
    })
    expect(indicator()).toBeNull()
    expect(screen.getByText('Step 3')).toBeTruthy()

    // A tool after some words: the indicator comes back under them.
    act(() => {
      local.emit('chat.progress', { thread: 'ask', messageId: 'm1', label: 'Updating your notes…' })
    })
    expect(step()).toBe('Updating your notes…')
    expect(screen.getByText('Step 3')).toBeTruthy()

    await act(async () => resolve(RESULT))
    expect(indicator()).toBeNull()
    expect(screen.getByText('Molar mass')).toBeTruthy()
  })

  it('goes away when an error arrives instead of the reply', async () => {
    let reject: (e: Error) => void = () => {}
    const local = setup(() => new Promise<AskResult>((_, r) => (reject = r)))
    ask('search the web for d-separation')
    await flush()
    act(() => {
      local.emit('chat.progress', { thread: 'ask', messageId: 'm1', label: 'Searching the web…' })
    })
    await wait(HOLD_MS)
    expect(step()).toBe('Searching the web…')
    await act(async () => reject(new Error('Gemini is busy')))
    expect(indicator()).toBeNull()
    expect(screen.getByRole('alert').textContent).toMatch(/Gemini is busy/)
    // A late step from the failed turn shows nothing.
    act(() => {
      local.emit('chat.progress', { thread: 'ask', messageId: 'm1', label: 'Thinking…' })
    })
    expect(indicator()).toBeNull()
  })
})
