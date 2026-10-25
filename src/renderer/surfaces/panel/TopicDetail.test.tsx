/**
 * The panel's topic detail with subtopics (mock `addDemoSubtopics`: Carbocation stability →
 * Hyperconjugation, Carbocation rearrangements → Hydride shifts, plus an outline passage):
 * the subtopic tree first (closed, chevrons open children in place), a name opens the same detail,
 * back and Esc go up one level; each level lists only its own notes, split into "Your notes" and
 * "Extracted"; a note opens in full on click; long sections show "Show all (N)".
 */
import { useToasts } from '@renderer/design-system'
import { addDemoSubtopics } from '@renderer/lib/mock/demo-subtopics'
import type { Note } from '@shared/domain'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { EMPTY_FLAGS, NOTES_SHOWN } from './TopicDetail'
import { renderPanel } from './testing/render'

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

async function openTopic(name: string) {
  const list = await screen.findByRole('list', { name: 'Topics' })
  const row = within(list)
    .getAllByRole('button')
    .find((b) => b.textContent?.startsWith(name))
  if (!row) throw new Error(`no topic ${name}`)
  fireEvent.click(row)
  await screen.findByRole('heading', { name })
}

const nameButton = (name: string) => screen.getByRole('button', { name })

const texts = (label: string) =>
  within(screen.getByRole('list', { name: label }))
    .getAllByRole('listitem')
    .map((li) => li.querySelector('.pn-note__text')?.textContent ?? '')

describe('TopicDetail with subtopics', () => {
  it('shows the subtopic tree first, then the roadmap, your notes and extracted (own only)', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    const tree = await screen.findByRole('list', { name: 'Subtopics' })
    const top = [...tree.children].map((li) => li.querySelector('.pn-topic__name')?.textContent)
    expect(top).toEqual(['Hyperconjugation', 'Carbocation rearrangements'])
    // Closed at first; only the row with children has a chevron.
    expect(screen.queryByText('Hydride shifts')).toBeNull()
    expect(screen.queryByRole('button', { name: /subtopics of Hyperconjugation/ })).toBeNull()
    const toggle = screen.getByRole('button', {
      name: 'Show subtopics of Carbocation rearrangements',
    })
    expect(toggle.getAttribute('aria-expanded')).toBe('false')
    fireEvent.click(toggle)
    expect(
      screen.getByRole('list', { name: 'Subtopics of Carbocation rearrangements' }),
    ).toBeTruthy()
    expect(nameButton('Hydride shifts')).toBeTruthy()
    fireEvent.click(
      screen.getByRole('button', { name: 'Hide subtopics of Carbocation rearrangements' }),
    )
    expect(screen.queryByText('Hydride shifts')).toBeNull()

    const section = screen.getByRole('region', { name: 'Carbocation stability' })
    const order = [...section.querySelectorAll('ul[aria-label], ol[aria-label]')].map((el) =>
      el.getAttribute('aria-label'),
    )
    expect(order).toEqual(['Subtopics', 'Roadmap steps', 'Your notes', 'Extracted'])
    expect(texts('Your notes')).toEqual([expect.stringMatching(/stabilise the positive charge/)])
    const extracted = texts('Extracted')
    expect(extracted[0]).toMatch(/neighbouring alkyl groups/) // the outline passage
    expect(extracted.join(' ')).toMatch(/tertiary > secondary/)
    expect(extracted.join(' ')).not.toMatch(/C–H bond|hydride shift/i)
    expect(screen.getByRole('list', { name: 'Extracted' }).textContent).toMatch(
      /Wikipedia · 20 min/,
    )
    expect(screen.getByRole('list', { name: 'Extracted' }).textContent).not.toMatch(/Ilari/)
  })

  it('a click opens a note in full and closes it again; ✕ deletes it', async () => {
    const r = renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    const list = await screen.findByRole('list', { name: 'Your notes' })
    const body = within(list).getAllByRole('button', { expanded: false })[0] as HTMLElement
    fireEvent.click(body)
    expect(body.getAttribute('aria-expanded')).toBe('true')
    expect(body.closest('li')?.hasAttribute('data-open')).toBe(true)
    fireEvent.click(body)
    expect(body.getAttribute('aria-expanded')).toBe('false')
    expect(screen.queryByRole('button', { name: 'More' })).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Delete note' }))
    await waitFor(() => expect(r.calls('notes.delete')).toEqual(['note_cc2']))
    expect(await screen.findByText(EMPTY_FLAGS)).toBeTruthy()
  })

  it('a long section shows the newest few and "Show all (N)"', async () => {
    renderPanel({
      prepare: (db) => {
        addDemoSubtopics(db)
        const base = db.notes.find((n) => n.id === 'note_cc1') as Note
        for (let i = 0; i < 6; i++) db.notes.push({ ...base, id: `note_x${i}`, text: `Fact ${i}` })
      },
    })
    await openTopic('Carbocation stability')
    await screen.findByRole('list', { name: 'Extracted' })
    expect(texts('Extracted')).toHaveLength(NOTES_SHOWN)
    fireEvent.click(screen.getByRole('button', { name: 'Show all (8)' }))
    expect(texts('Extracted')).toHaveLength(8)
    expect(screen.queryByRole('button', { name: /Show all/ })).toBeNull()
  })

  it('a subtopic name opens its own detail; back goes up one level, then to the topics', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await screen.findByRole('list', { name: 'Subtopics' })
    fireEvent.click(nameButton('Carbocation rearrangements'))
    expect(await screen.findByRole('heading', { name: 'Carbocation rearrangements' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: /lock this topic/i })).toBeNull()
    expect(screen.getByText(EMPTY_FLAGS)).toBeTruthy()
    fireEvent.click(nameButton('Hydride shifts'))
    expect(await screen.findByRole('heading', { name: 'Hydride shifts' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Subtopics' })).toBeNull()
    expect(texts('Your notes')).toEqual([expect.stringMatching(/1,2-hydride shift/)])
    expect(screen.getByRole('list', { name: 'Your notes' }).textContent).toMatch(
      /Chemistry LibreTexts/,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Back to Carbocation rearrangements' }))
    expect(await screen.findByRole('heading', { name: 'Carbocation rearrangements' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to Carbocation stability' }))
    expect(await screen.findByRole('heading', { name: 'Carbocation stability' })).toBeTruthy()
    expect(screen.getByRole('button', { name: 'Lock this topic' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Back to topics' }))
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
  })

  it('Esc goes up one level at a time, then back to the topics', async () => {
    const r = renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Carbocation stability')
    await screen.findByRole('list', { name: 'Subtopics' })
    fireEvent.click(nameButton('Hyperconjugation'))
    expect(await screen.findByRole('heading', { name: 'Hyperconjugation' })).toBeTruthy()
    expect(texts('Your notes')).toEqual([expect.stringMatching(/C–H bond/)])
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(await screen.findByRole('heading', { name: 'Carbocation stability' })).toBeTruthy()
    act(() => {
      fireEvent.keyDown(window, { key: 'Escape' })
    })
    expect(await screen.findByRole('list', { name: 'Topics' })).toBeTruthy()
    expect(r.calls('window.close')).toEqual([])
  })

  it('a topic without subtopics has no tree', async () => {
    renderPanel({ prepare: addDemoSubtopics })
    await openTopic('Plate tectonics')
    expect(await screen.findByRole('list', { name: 'Your notes' })).toBeTruthy()
    expect(screen.queryByRole('list', { name: 'Subtopics' })).toBeNull()
  })
})
