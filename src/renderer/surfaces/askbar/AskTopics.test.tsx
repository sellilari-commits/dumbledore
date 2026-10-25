import { DEFAULT_SETTINGS } from '@shared/domain'
import type { InvokeChannel } from '@shared/ipc'
import type { AskResult } from '@shared/state'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import type { InvokeHandlers } from '../overlay/lib/localApi'
import { fakeApi } from '../overlay/testing/fakeApi'
import { AskBar, PLACEHOLDER, topicPlaceholder } from './AskBar'
import { demoSession, demoSubject, demoSubjects } from './mock/askTopics'
import { loadTopics, moveIndex } from './useTopics'

const RESULT: AskResult = { reply: 'Sure.', actions: [], pasted: false }
const NOW = Date.parse('2026-10-24T10:00:00.000Z')

function topicsApi(extra: InvokeHandlers = {}) {
  return fakeApi(
    {
      'chat.history': () => [],
      'subjects.list': () => demoSubjects(NOW),
      'subjects.get': (id) => demoSubject(id, NOW),
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
const names = () =>
  Array.from(
    screen.getByRole('group', { name: 'Topics' }).querySelectorAll('.ask__topic-name'),
  ).map((n) => n.textContent)
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
  delete document.documentElement.dataset.theme
})

describe('loadTopics / moveIndex', () => {
  it('lists every topic of the counted subjects, newest information first, as the panel does', async () => {
    const topics = await loadTopics(topicsApi().api)
    expect(topics).toHaveLength(19)
    expect(topics.slice(0, 3).map((t) => t.name)).toEqual([
      'Carbocation stability',
      'Integration by parts',
      'SN1 mechanism',
    ])
    expect(topics.at(-1)?.name).toBe('Utilitarianism')
    const twins = topics.filter((t) => t.name === 'Equilibrium')
    expect(twins.map((t) => t.subjectLabel)).toEqual(['Organic chemistry', 'Microeconomics'])
    expect(topics.find((t) => t.name === 'Quicksort')?.subjectLabel).toBeNull()
  })

  it('leaves out archived subjects and keeps the rest when one subject fails to load', async () => {
    const local = topicsApi({
      'subjects.list': () =>
        demoSubjects(NOW).map((s) => (s.id === 'sub_phil' ? { ...s, status: 'archived' } : s)),
      'subjects.get': (id) => {
        if (id === 'sub_algo') throw new Error('gone')
        return demoSubject(id, NOW)
      },
    })
    const topics = (await loadTopics(local.api)).map((t) => t.name)
    expect(topics).toHaveLength(15)
    expect(topics).not.toContain('Utilitarianism')
    expect(topics).not.toContain('Quicksort')
    expect(callsTo(local, 'subjects.get')).not.toContain('sub_phil')
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

describe('AskBar topic chips', () => {
  it('shows every topic, newest first; nothing selected', async () => {
    await mount()
    expect(names()).toHaveLength(19)
    expect(names().slice(0, 3)).toEqual([
      'Carbocation stability',
      'Integration by parts',
      'SN1 mechanism',
    ])
    expect(pressed()).toEqual([])
    expect(input().placeholder).toBe(PLACEHOLDER)
  })

  it('a topic whose name is in two subjects shows its subject', async () => {
    await mount()
    const labels = Array.from(document.querySelectorAll('.ask__topic-subject')).map(
      (n) => n.textContent,
    )
    expect(labels).toEqual(['Organic chemistry', 'Microeconomics'])
  })

  it('a click selects and a second click deselects, with no other call', async () => {
    const local = await mount()
    const before = local.calls.length
    fireEvent.click(chip('Taylor series'))
    expect(pressed()).toEqual(['Taylor series'])
    expect(input().placeholder).toBe(topicPlaceholder('Taylor series', false))
    fireEvent.click(chip('Quicksort'))
    expect(pressed()).toEqual(['Quicksort'])
    fireEvent.click(chip('Quicksort'))
    expect(pressed()).toEqual([])
    const after = local.calls.slice(before).map((c) => c.channel)
    expect(after.filter((c) => c !== 'window.setSize')).toEqual([])
  })

  it("Enter with text asks with the topic's subject as subjectId", async () => {
    const local = await mount()
    fireEvent.click(chip('Mitosis'))
    fireEvent.change(input(), { target: { value: ' what is mitosis ' } })
    key('Enter')
    await flush()
    expect(callsTo(local, 'ask.submit')).toEqual([
      { text: 'what is mitosis', subjectId: 'sub_bio' },
    ])
    expect(callsTo(local, 'session.start')).toEqual([])
    expect(pressed()).toEqual(['Mitosis'])
  })

  it('Enter on an empty input studies the selected topic and closes the bar', async () => {
    const local = await mount()
    fireEvent.click(chip('Integration by parts'))
    expect(screen.getByText('Study')).toBeTruthy()
    key('Enter')
    await flush()
    expect(callsTo(local, 'session.start')).toEqual([
      { subjectId: 'sub_calc', goal: 'Integration by parts', question: null },
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
    fireEvent.click(chip('Taylor series'))
    key('Enter')
    await flush()
    expect(screen.getByRole('alert').textContent).toContain('No assistant chat open')
    expect(callsTo(local, 'window.close')).toEqual([])
  })

  it('←/→ move the selection while the input is empty, not while typing', async () => {
    await mount()
    key('ArrowRight')
    expect(pressed()).toEqual(['Carbocation stability'])
    key('ArrowRight')
    key('ArrowRight')
    expect(pressed()).toEqual(['SN1 mechanism'])
    key('ArrowLeft')
    expect(pressed()).toEqual(['Integration by parts'])
    fireEvent.change(input(), { target: { value: 'x' } })
    key('ArrowRight')
    expect(pressed()).toEqual(['Integration by parts'])
  })

  it('no subjects → no chips', async () => {
    await mount({ 'subjects.list': () => [] })
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull()
  })

  it('the prompt box shows no topics and loads none', async () => {
    window.location.hash = '#/prompt'
    const local = await mount()
    expect(screen.queryByRole('group', { name: 'Topics' })).toBeNull()
    expect(callsTo(local, 'subjects.list')).toEqual([])
  })
})

describe('AskBar topic chips stay live, like the panel', () => {
  /** subjects.get with the named topics left out (consolidation merged or moved them). */
  function liveTopics() {
    const gone = new Set<string>()
    const local = topicsApi({
      'subjects.get': (id) => {
        const s = demoSubject(id, NOW)
        return { ...s, concepts: s.concepts.filter((c) => !gone.has(c.name)) }
      },
    })
    render(<AskBar api={local.api} />)
    return { local, gone }
  }

  it('a memory change removes a topic that no longer exists and clears its selection', async () => {
    const { local, gone } = liveTopics()
    await flush()
    fireEvent.click(chip('Taylor series'))
    expect(pressed()).toEqual(['Taylor series'])
    gone.add('Taylor series')
    act(() => local.emit('memory.changed', { scope: 'concepts', ids: [] }))
    await flush()
    expect(names()).toHaveLength(18)
    expect(names()).not.toContain('Taylor series')
    expect(pressed()).toEqual([])
  })

  it('a memory change keeps the selected topic while it still exists', async () => {
    const { local, gone } = liveTopics()
    await flush()
    fireEvent.click(chip('Mitosis'))
    gone.add('Quicksort')
    act(() => local.emit('memory.changed', { scope: 'subjects', ids: [] }))
    await flush()
    expect(names()).not.toContain('Quicksort')
    expect(pressed()).toEqual(['Mitosis'])
  })

  it('showing the bar again (navigate on open) reloads the topics, with no focus event', async () => {
    const { local, gone } = liveTopics()
    await flush()
    expect(names()).toContain('Utilitarianism')
    gone.add('Utilitarianism')
    act(() => local.emit('navigate', { route: '/' }))
    await flush()
    expect(names()).toHaveLength(18)
    expect(names()).not.toContain('Utilitarianism')
  })

  it('changes that cannot touch topics (chat, settings) load nothing', async () => {
    const { local } = liveTopics()
    await flush()
    const before = callsTo(local, 'subjects.list').length
    act(() => local.emit('memory.changed', { scope: 'chat', ids: [] }))
    act(() => local.emit('memory.changed', { scope: 'settings', ids: [] }))
    await flush()
    expect(callsTo(local, 'subjects.list')).toHaveLength(before)
  })
})

describe('AskBar theme', () => {
  it('follows the theme in Settings, like the orb and the mini panel', async () => {
    await mount({ 'settings.get': () => ({ ...DEFAULT_SETTINGS, theme: 'dark' }) })
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('stays on the system theme when Settings say so', async () => {
    document.documentElement.dataset.theme = 'dark'
    await mount({ 'settings.get': () => ({ ...DEFAULT_SETTINGS, theme: 'system' }) })
    expect(document.documentElement.dataset.theme).toBeUndefined()
  })
})
