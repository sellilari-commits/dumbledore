/**
 * Mini panel against the mock API: topic names only (every counted subject, newest first), the
 * current topic softly marked, a click locks a topic (it never opens the app), the header's lock
 * toggles between a held topic and following the latest, and the window is sized to the card.
 */
import { useToasts } from '@renderer/design-system'
import type { MockDb } from '@renderer/lib/mock/db'
import { listTopics } from '@shared/topics'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
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

  it('clicking a topic makes it current and locks it, without opening the app', async () => {
    const r = renderPanel()
    const pick = expectedTopics(r.api.db).at(-1)
    if (!pick) throw new Error('demo has no topics')
    const row = (await rows()).find((b) => b.textContent?.startsWith(pick.name))
    fireEvent.click(row as HTMLElement)
    await waitFor(() => expect(r.api.db.settings.focusTopicId).toBe(pick.id))
    expect(r.api.db.settings.focusSubjectId).toBe(pick.subjectId)
    await waitFor(async () => expect(await current()).toBe(pick.name))
    expect(screen.getByRole('button', { name: 'Unlock topic' }).getAttribute('aria-pressed')).toBe(
      'true',
    )
    expect(r.calls('window.open')).toEqual([])
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
