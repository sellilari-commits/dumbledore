import type { InvokeChannel } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { InvokeHandlers } from '../overlay/lib/localApi'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar, PLACEHOLDER, topicPlaceholder } from './AskBar'
import { demoSession, demoTopics } from './mock/askTopics'
import { moveIndex, TOPIC_LIMIT, topicsFrom } from './useTopics'

const RESULT: AskResult = { reply: 'Sure.', actions: [], pasted: false }

function topicsApi(extra: InvokeHandlers = {}) {
  return fakeApi(
    {
      'chat.history': () => [],
      'session.picker': () => demoTopics(Date.parse('2026-10-24T10:00:00.000Z')),
      'session.start': ({ subjectId }) => demoSession(subjectId ?? ''),
      'ask.submit': () => RESULT,
      'coach.runAction': () => undefined,
      'window.close': () => undefined,
      'window.setSize': () => undefined,
      ...extra,
    },
    'askbar',
  )
}

type Local = ReturnType<typeof topicsApi>
const input = () => screen.getByRole('textbox', { name: 'Ask Dumbledore' }) as HTMLTextAreaElement
const flush = () => act(async () => {})
const callsTo = (local: Local, channel: InvokeChannel) =>
  local.calls.filter((c) => c.channel === channel).map((c) => c.payload)
const chip = (name: string) => screen.getByRole('button', { name: new RegExp(name) })
const pressed = () =>
  screen
    .queryAllByRole('button', { pressed: true })
    .map((b) => b.querySelector('.ask__topic-name')?.textContent ?? '')
const key = (k: string) => fireEvent.keyDown(input(), { key: k })

async function mount(extra: InvokeHandlers = {}) {
  const local = topicsApi(extra)
  render(<AskBar api={local.api} />)
  await flush()
  return local
}

afterEach(() => {
  cleanup()
  window.localStorage.clear()
  window.location.hash = ''
})

describe('topicsFrom / moveIndex', () => {
  it('orders by last studied (never studied last) and keeps at most TOPIC_LIMIT', () => {
    const data = demoTopics()
    const reversed = { subjects: [...data.subjects].reverse() }
    const names = topicsFrom(reversed).map((t) => t.name)
    expect(names[0]).toBe('Organic chemistry')
    expect(names.at(-1)).toBe('Ethics')
    const many = {
      subjects: [...data.subjects, ...data.subjects].map((s, i) => ({
        ...s,
        subject: { ...s.subject, id: `s${i}` },
      })),
    }
    expect(topicsFrom(many)).toHaveLength(TOPIC_LIMIT)
  })

  it('moves inside the row; the first step selects the first topic', () => {
    expect(moveIndex(-1, 1, 3)).toBe(0)
    expect(moveIndex(-1, -1, 3)).toBe(0)
    expect(moveIndex(0, -1, 3)).toBe(0)
    expect(moveIndex(1, 1, 3)).toBe(2)
    expect(moveIndex(2, 1, 3)).toBe(2)
    expect(moveIndex(-1, 1, 0)).toBe(-1)
  })
})

describe('AskBar topic row', () => {
  it('shows the recent topics, most recent first; nothing selected', async () => {
    await mount()
    const group = screen.getByRole('group', { name: 'Topics' })
    const names = Array.from(group.querySelectorAll('.ask__topic-name')).map((n) => n.textContent)
    expect(names.slice(0, 3)).toEqual(['Organic chemistry', 'Calculus II', 'Cold War history'])
    expect(pressed()).toEqual([])
    expect(input().placeholder).toBe(PLACEHOLDER)
  })

  it('a click selects and a second click deselects, with no other call', async () => {
    const local = await mount()
    const before = local.calls.length
    fireEvent.click(chip('Calculus II'))
    expect(pressed()).toEqual(['Calculus II'])
    expect(input().placeholder).toBe(topicPlaceholder('Calculus II', false))
    fireEvent.click(chip('Algorithms'))
    expect(pressed()).toEqual(['Algorithms'])
    fireEvent.click(chip('Algorithms'))
    expect(pressed()).toEqual([])
    const after = local.calls.slice(before).map((c) => c.channel)
    expect(after.filter((c) => c !== 'window.setSize')).toEqual([])
  })

  it('Enter with text asks with the topic as subjectId', async () => {
    const local = await mount()
    fireEvent.click(chip('Cell biology'))
    fireEvent.change(input(), { target: { value: ' what is mitosis ' } })
    key('Enter')
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([
      { text: 'what is mitosis', subjectId: 'sub_bio' },
    ])
    expect(callsTo(local, 'session.start')).toEqual([])
    expect(pressed()).toEqual(['Cell biology'])
  })

  it('Enter on an empty input studies the selected topic and closes the bar', async () => {
    const local = await mount()
    fireEvent.click(chip('Calculus II'))
    expect(screen.getByText('Study')).toBeTruthy()
    key('Enter')
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([
      { subjectId: 'sub_calc', goal: null, question: null },
    ])
    expect(callsTo(local, 'window.close')).toEqual(['askbar'])
    expect(callsTo(local, 'ask.submit')).toEqual([])
  })

  it('Enter on an empty input with no topic does nothing', async () => {
    const local = await mount()
    key('Enter')
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([])
    expect(callsTo(local, 'ask.submit')).toEqual([])
    expect(callsTo(local, 'window.close')).toEqual([])
  })

  it('a failed start shows the error and keeps the bar open', async () => {
    const local = await mount({
      'session.start': () => {
        throw new Error('No assistant chat open')
      },
    })
    fireEvent.click(chip('Calculus II'))
    key('Enter')
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('No assistant chat open')
    expect(callsTo(local, 'window.close')).toEqual([])
  })

  it('←/→ move the selection while the input is empty, not while typing', async () => {
    await mount()
    key('ArrowRight')
    expect(pressed()).toEqual(['Organic chemistry'])
    key('ArrowRight')
    key('ArrowRight')
    expect(pressed()).toEqual(['Cold War history'])
    key('ArrowLeft')
    expect(pressed()).toEqual(['Calculus II'])
    fireEvent.change(input(), { target: { value: 'x' } })
    key('ArrowRight')
    expect(pressed()).toEqual(['Calculus II'])
  })

  it('no subjects → no row', async () => {
    await mount({ 'session.picker': () => ({ subjects: [] }) })
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull()
  })

  it('the prompt box shows no topics and loads none', async () => {
    window.location.hash = '#/prompt'
    const local = await mount()
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull()
    expect(callsTo(local, 'session.picker')).toEqual([])
  })
})
