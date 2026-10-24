import type { InvokeChannel } from '@shared/ipc'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar, NEW_TOPIC } from './AskBar'
import { demoPicker } from './mock/askReplies'
import { CHOICE_LIMIT, choicesFrom, isChooseRoute } from './useChoose'

function chooseApi() {
  return fakeApi(
    {
      'chat.history': () => [],
      'ask.submit': () => ({ reply: 'Hi.', actions: [], pasted: false }),
      'session.picker': () => demoPicker(Date.parse('2026-10-24T12:00:00.000Z')),
      'session.start': () => {
        throw new Error('not in tests')
      },
      'window.close': () => undefined,
      'window.setSize': () => undefined,
    },
    'askbar',
  )
}

const input = () => screen.getByRole('textbox', { name: 'Ask Dumbledore' }) as HTMLTextAreaElement
const flush = () => act(async () => {})
const callsTo = (local: ReturnType<typeof chooseApi>, channel: InvokeChannel) =>
  local.calls.filter((c) => c.channel === channel).map((c) => c.payload)
const rows = () => document.querySelectorAll('.ask__choices .ask__choice')

beforeEach(() => {
  window.location.hash = '#/choose'
})

afterEach(() => {
  cleanup()
  window.location.hash = ''
})

describe('Ask bar choose view (route choose)', () => {
  it('lists recent subjects first, then New topic…', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    expect(callsTo(local, 'session.picker')).toHaveLength(1)
    expect([...rows()].map((r) => r.textContent)).toEqual([
      '🧪Organic ChemistryContinue your roadmap↵',
      '📐Linear Algebra2 open questions',
      '🧬Cell Biology1 open question',
      '🏛️European HistoryStart a roadmap',
      'New topic…',
    ])
  })

  it('picking a subject starts its session and closes the bar', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: /Linear Algebra/ }))
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([
      { subjectId: 'sub_lin', goal: null, question: null },
    ])
    expect(local.calls.at(-1)).toEqual({ channel: 'window.close', payload: 'askbar' })
    expect(screen.queryByText('What do you want to study?')).toBeNull()
  })

  it('↓ and ↵ on an empty input pick from the keyboard', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowDown' })
    fireEvent.keyDown(input(), { key: 'ArrowUp' })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([
      { subjectId: 'sub_lin', goal: null, question: null },
    ])
  })

  it('New topic… turns what the student types into a cold start', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.click(screen.getByRole('button', { name: 'New topic…' }))
    expect(input().placeholder).toBe(NEW_TOPIC)
    expect(document.activeElement).toBe(input())
    fireEvent.change(input(), { target: { value: 'the Calvin cycle' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([
      { subjectId: null, goal: 'the Calvin cycle', question: null },
    ])
    expect(callsTo(local, 'ask.submit')).toEqual([])
    expect(callsTo(local, 'window.close')).toEqual(['askbar'])
  })

  it('typing a question chats as usual and hides the choices', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.change(input(), { target: { value: 'what is a mole?' } })
    fireEvent.keyDown(input(), { key: 'Enter' })
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([{ text: 'what is a mole?' }])
    expect(screen.queryByText('What do you want to study?')).toBeNull()
    expect(screen.getByText('Hi.')).toBeTruthy()
  })

  it('Esc closes; leaving the window ends the mode; navigate starts it again', async () => {
    const local = chooseApi()
    render(<AskBar api={local.api} />)
    await flush()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(callsTo(local, 'window.close')).toEqual(['askbar'])
    expect(screen.queryByText('What do you want to study?')).toBeNull()
    act(() => local.emit('navigate', { route: 'choose' }))
    await flush()
    expect(rows()).toHaveLength(5)
    act(() => {
      window.dispatchEvent(new Event('blur'))
    })
    expect(screen.queryByText('What do you want to study?')).toBeNull()
  })
})

describe('choose helpers', () => {
  it('recognises the route in its forms', () => {
    expect(isChooseRoute('choose')).toBe(true)
    expect(isChooseRoute('/choose')).toBe(true)
    expect(isChooseRoute('#/choose')).toBe(true)
    expect(isChooseRoute('/subjects/x')).toBe(false)
    expect(isChooseRoute(null)).toBe(false)
  })

  it('keeps at most CHOICE_LIMIT subjects', () => {
    const data = demoPicker()
    const many = { subjects: [...data.subjects, ...data.subjects, ...data.subjects] }
    expect(choicesFrom(many)).toHaveLength(CHOICE_LIMIT)
  })
})
