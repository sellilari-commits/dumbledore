/**
 * Mini panel against the mock API: topic names only (every counted subject, newest first), the
 * current topic softly marked, a click opens the topic's detail (roadmap and flags) in place, the
 * header's lock toggles between a held topic and following the latest, and the window is sized to
 * the card.
 */
import { useToasts } from '@renderer/design-system'
import type { MockDb } from '@renderer/lib/mock/db'
import { listTopics } from '@shared/topics'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FLAGS } from './TopicDetail'
import { EMPTY_TOPICS } from './TopicList'
import { renderPanel } from './testing/render'
import { MIN_HEIGHT, PANEL_WIDTH } from './usePanelAutoSize'

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

const expectedTopics = (db: MockDb) =>
  listTopics(db.subjects, (id) => db.concepts.filter((c) => c.subjectId === id))

const rows = async () => {
  const list = await screen.findByRole('list', { name: 'Topics' })
  return within(list).getAllByRole('button')
}

const names = async () => (await rows()).map((b) => b.querySelector('.pn-topic__name')?.textContent)

const current = async () =>
  (await rows())
    .find((b) => b.getAttribute('aria-current') === 'true')
    ?.querySelector('.pn-topic__name')?.textContent

describe('MiniPanel', () => {
  it('lists topic names of every subject, newest first, and nothing else', async () => {
    const r = renderPanel()
    const expected = expectedTopics(r.api.db)
    expect(expected.length).toBeGreaterThan(1)
    expect(await names()).toEqual(expected.map((t) => t.name))
    expect(screen.queryByRole('button', { name: /subject:/i })).toBeNull()
    expect(screen.queryByText(/goals & due/i)).toBeNull()
    expect(screen.queryByRole('textbox', { name: 'Ask Dumbledore' })).toBeNull()
  })

  it('unlocked, the newest topic is current', async () => {
    const r = renderPanel()
    expect(await current()).toBe(expectedTopics(r.api.db)[0]?.name)
    expect(screen.getByRole('button', { name: 'Lock topic' }).getAttribute('aria-pressed')).toBe(
      'false',
    )
  })

  it('clicking a topic opens its detail in place, without opening the app or locking it', async () => {
    const r = renderPanel()
    const row = (await rows()).find((b) => b.textContent?.startsWith('Carbocation stability'))
    fireEvent.click(row as HTMLElement)
    expect(await screen.findByRole('heading', { name: 'Carbocation stability' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Topics' })).toBeNull()
    expect(r.calls('window.open')).toEqual([])
    expect(r.calls('settings.update')).toEqual([])
    fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
  })

  it('the detail shows the roadmap with each step state, and the flags', async () => {
    renderPanel()
    fireEvent.click(
      (await rows()).find((b) => b.textContent?.startsWith('Carbocation stability')) as HTMLElement,
    )
    const steps = await screen.findByRole('list', { name: 'Roadmap steps' })
    const items = within(steps).getAllByRole('listitem')
    expect(items.map((li) => li.getAttribute('data-state'))).toContain('done')
    expect(items.find((li) => li.getAttribute('aria-current') === 'step')?.textContent).toMatch(
      /Carbocation stability/,
    )
    expect(items.some((li) => li.getAttribute('data-kind') === 'checkpoint')).toBe(true)
    const flags = await screen.findByRole('list', { name: 'Flags' })
    expect(flags.textContent).toMatch(/hyperconjugation/)
    expect(flags.textContent).toMatch(/LibreTexts/)
  })

  it('without a roadmap only the flags show, and with no flags one calm line', async () => {
    renderPanel({
      prepare: (db) => {
        db.roadmaps = []
        db.notes = db.notes.filter((n) => n.kind !== 'highlight')
      },
    })
    fireEvent.click(
      (await rows()).find((b) => b.textContent?.startsWith('Carbocation stability')) as HTMLElement,
    )
    expect(await screen.findByText(EMPTY_FLAGS)).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Roadmap steps' })).toBeNull()
    expect(screen.queryByRole('heading', { name: /Flags/ })).toBeNull()
  })

  it('✕ deletes a flag', async () => {
    const r = renderPanel()
    fireEvent.click(
      (await rows()).find((b) => b.textContent?.startsWith('Carbocation stability')) as HTMLElement,
    )
    const flags = await screen.findByRole('list', { name: 'Flags' })
    fireEvent.click(within(flags).getAllByRole('button', { name: 'Delete flag' })[0] as HTMLElement)
    await waitFor(() => expect(r.calls('notes.delete')).toEqual(['note_cc2']))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'Flags' })).toBeNull())
  })

  it('locks a topic from its detail, and unlocks it again', async () => {
    const r = renderPanel()
    const pick = expectedTopics(r.api.db).find((t) => t.name === 'Carbocation stability')
    if (!pick) throw new Error('demo has no carbocation topic')
    fireEvent.click((await rows()).find((b) => b.textContent?.startsWith(pick.name)) as HTMLElement)
    fireEvent.click(await screen.findByRole('button', { name: 'Lock this topic' }))
    await waitFor(() => expect(r.api.db.settings.focusTopicId).toBe(pick.id))
    expect(r.api.db.settings.focusSubjectId).toBe(pick.subjectId)
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock this topic' }))
    await waitFor(() => expect(r.api.db.settings.focusTopicId).toBeNull())
  })

  it('Esc goes back from a detail, then closes', async () => {
    const r = renderPanel()
    fireEvent.click((await rows())[0] as HTMLElement)
    await screen.findByRole('button', { name: 'Back to topics' })
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
    expect(r.calls('window.close')).toEqual([])
  })

  it('the lock holds the current topic, and unlocking follows the latest again', async () => {
    const r = renderPanel()
    const newest = expectedTopics(r.api.db)[0]
    if (!newest) throw new Error('demo has no topics')
    await rows()
    fireEvent.click(screen.getByRole('button', { name: 'Lock topic' }))
    await waitFor(() => expect(r.api.db.settings.focusTopicId).toBe(newest.id))
    fireEvent.click(await screen.findByRole('button', { name: 'Unlock topic' }))
    await waitFor(() => expect(r.api.db.settings.focusTopicId).toBeNull())
    expect(r.calls('settings.update')).toEqual([
      { focusTopicId: newest.id, focusSubjectId: newest.subjectId },
      { focusTopicId: null, focusSubjectId: null },
    ])
  })

  it('a locked topic stays current even when another topic is newer', async () => {
    let held = ''
    renderPanel({
      prepare: (db) => {
        const oldest = expectedTopics(db).at(-1)
        held = oldest?.name ?? ''
        db.settings.focusTopicId = oldest?.id ?? null
      },
    })
    expect(await current()).toBe(held)
  })

  it('refreshes live when memory changes, without reopening', async () => {
    const r = renderPanel()
    await rows()
    const subject = r.api.db.subjects.find((s) => s.status === 'active')
    if (!subject) throw new Error('demo has no subject')
    const seed = r.api.db.concepts.find((c) => c.subjectId === subject.id)
    if (!seed) throw new Error('demo has no concept')
    r.api.db.concepts.push({
      ...seed,
      id: 'con_fresh',
      name: 'Fresh topic',
      parentId: null,
      lastSeenAt: new Date(Date.now() + 60_000).toISOString(),
    })
    act(() => r.api.emit('memory.changed', { scope: 'concepts', ids: ['con_fresh'] }))
    await waitFor(async () => expect((await names())[0]).toBe('Fresh topic'))
    expect(await current()).toBe('Fresh topic')
  })

  it('fits the window to the card', async () => {
    const r = renderPanel()
    await rows()
    await waitFor(() =>
      expect(r.calls('window.setSize')).toContainEqual({
        surface: 'panel',
        width: PANEL_WIDTH,
        height: MIN_HEIGHT,
      }),
    )
  })

  it('pauses capture from the header switch', async () => {
    const r = renderPanel()
    const capture = await screen.findByRole('switch', { name: /pause capture/i })
    await waitFor(() => expect((capture as HTMLButtonElement).disabled).toBe(false))
    fireEvent.click(capture)
    await waitFor(() => expect(r.api.db.settings.captureEnabled).toBe(false))
    expect(r.calls('capture.setEnabled')).toEqual([false])
  })

  it('shows one calm line on the first day', async () => {
    renderPanel({ scenario: 'empty' })
    expect(await screen.findByText(EMPTY_TOPICS)).toBeTruthy()
  })

  it('says what failed when the engine does not answer', async () => {
    renderPanel({ scenario: 'error' })
    expect((await screen.findByRole('alert')).textContent).toMatch(/didn’t answer/)
  })

  it('closes on Esc', async () => {
    const r = renderPanel()
    await rows()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    await waitFor(() => expect(r.calls('window.close')).toEqual(['panel']))
  })
})
