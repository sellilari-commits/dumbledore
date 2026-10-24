/**
 * Inbox against the mock API: rows with the three parts and the source, keep / ignore / restore /
 * file under a subject, suggested subjects (add, merge, dismiss), the state and subject filters,
 * and the first-day / loading / error states.
 */
import { useToasts } from '@renderer/design-system'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { InboxPage } from './InboxPage'

const toasts = () => useToasts.getState().toasts.map((t) => t.text)
const render = (scenario?: 'empty' | 'slow' | 'error') =>
  renderWithApp(<InboxPage />, { route: '/inbox', scenario })
const encounter = (r: ReturnType<typeof render>, id: string) =>
  r.api.db.encounters.find((e) => e.id === id)

/** Opens a Radix menu from its trigger and picks an item. */
async function pick(trigger: HTMLElement, item: RegExp) {
  fireEvent.keyDown(trigger, { key: 'Enter' })
  fireEvent.click(await screen.findByRole('menuitem', { name: item }))
}

beforeEach(() => {
  useToasts.setState({ toasts: [] })
})

describe('InboxPage', () => {
  it('shows new extractions with the three parts and their source', async () => {
    render()
    const row = await screen.findByRole('article', { name: 'SN1 reaction – Wikipedia' })
    expect(within(row).getByText('Seen')).toBeTruthy()
    expect(within(row).getByText(/Rate = k\[R–X\]/)).toBeTruthy()
    expect(within(row).getByText('Big picture')).toBeTruthy()
    expect(within(row).getByText(/Nucleophilic substitution › SN1 vs SN2/)).toBeTruthy()
    expect(within(row).getByText('Understanding')).toBeTruthy()
    expect(within(row).getByText('Struggling')).toBeTruthy()
    expect(within(row).getByText('Google Chrome · en.wikipedia.org · 7 min')).toBeTruthy()
    expect(within(row).getByText('38 min ago')).toBeTruthy()
    expect(screen.getAllByRole('article')).toHaveLength(6)
    expect(screen.getByRole('tab', { name: /New/ }).textContent).toContain('6')
    expect(screen.getByText(/Watching your screen · \d+ new today/)).toBeTruthy()
  })

  it('keeps an item: it leaves New at once and shows under Kept', async () => {
    const r = render()
    const row = await screen.findByRole('article', { name: 'SN1 reaction – Wikipedia' })
    fireEvent.click(within(row).getByRole('button', { name: 'Keep' }))
    expect(screen.queryByRole('article', { name: 'SN1 reaction – Wikipedia' })).toBeNull()
    await waitFor(() => expect(encounter(r, 'enc_sn1_wiki')?.inboxState).toBe('accepted'))
    expect(toasts()).toContain('Kept in 🧪 Organic Chemistry')
    fireEvent.click(screen.getByRole('tab', { name: /Kept/ }))
    expect(await screen.findByRole('article', { name: 'SN1 reaction – Wikipedia' })).toBeTruthy()
  })

  it('ignores an item and restores it from Ignored', async () => {
    const r = render()
    const row = await screen.findByRole('article', { name: 'Plate tectonics' })
    fireEvent.click(within(row).getByRole('button', { name: 'Ignore' }))
    await waitFor(() => expect(encounter(r, 'enc_plates')?.inboxState).toBe('ignored'))
    fireEvent.click(screen.getByRole('tab', { name: /Ignored/ }))
    const ignored = await screen.findByRole('article', { name: 'Plate tectonics' })
    fireEvent.click(within(ignored).getByRole('button', { name: 'Restore' }))
    await waitFor(() => expect(encounter(r, 'enc_plates')?.inboxState).toBe('accepted'))
  })

  it('files an unfiled item under a subject', async () => {
    const r = render()
    const row = await screen.findByRole('article', { name: 'Spaced repetition – Wikipedia' })
    expect(within(row).getByText('Choose a subject')).toBeTruthy()
    await pick(
      within(row).getByRole('button', { name: /File “Spaced repetition/ }),
      /Linear Algebra/,
    )
    await waitFor(() => expect(encounter(r, 'enc_spacing')?.subjectId).toBe('sub_linalg'))
    expect(encounter(r, 'enc_spacing')?.inboxState).toBe('accepted')
    expect(toasts()).toContain('Filed under 📐 Linear Algebra')
  })

  it('filters by subject and shows unfiled items', async () => {
    render()
    await screen.findAllByRole('article')
    await pick(screen.getByRole('button', { name: 'Filter by subject' }), /Linear Algebra/)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(2))
    expect(screen.getByRole('article', { name: 'Problem set 4 – MATH 2400' })).toBeTruthy()
    await pick(screen.getByRole('button', { name: 'Filter by subject' }), /Unfiled/)
    await waitFor(() => expect(screen.getAllByRole('article')).toHaveLength(1))
    expect(screen.getByRole('article', { name: 'Spaced repetition – Wikipedia' })).toBeTruthy()
  })

  it('shows every state under All, kept ones without a Keep button', async () => {
    render()
    await screen.findAllByRole('article')
    fireEvent.click(screen.getByRole('tab', { name: 'All' }))
    const kept = await screen.findByRole('article', {
      name: 'Lecture 7 – Substitution reactions.pdf',
    })
    expect(within(kept).getByText('Kept')).toBeTruthy()
    expect(within(kept).queryByRole('button', { name: 'Keep' })).toBeNull()
    expect(screen.getAllByRole('article').length).toBe(9)
  })

  it('merges a suggested subject into another one', async () => {
    const r = render()
    const suggested = await screen.findByRole('region', { name: 'Suggested subjects' })
    expect(within(suggested).getByText('Geography')).toBeTruthy()
    await pick(
      within(suggested).getByRole('button', { name: 'Merge Geography into another subject' }),
      /Organic Chemistry/,
    )
    await waitFor(() =>
      expect(r.api.db.subjects.find((s) => s.id === 'sub_geo')?.status).toBe('archived'),
    )
    expect(encounter(r, 'enc_plates')?.subjectId).toBe('sub_orgo')
    await waitFor(() =>
      expect(screen.queryByRole('region', { name: 'Suggested subjects' })).toBeNull(),
    )
  })

  it('adds a suggested subject', async () => {
    const r = render()
    fireEvent.click(await screen.findByRole('button', { name: 'Add Geography as a subject' }))
    await waitFor(() =>
      expect(r.api.db.subjects.find((s) => s.id === 'sub_geo')?.status).toBe('active'),
    )
    expect(toasts()).toContain('🌍 Geography added to your subjects')
  })

  it('dismisses a suggested subject', async () => {
    const r = render()
    fireEvent.click(await screen.findByRole('button', { name: 'Dismiss Geography' }))
    await waitFor(() =>
      expect(r.api.db.subjects.find((s) => s.id === 'sub_geo')?.status).toBe('archived'),
    )
    expect(toasts()).toContain('Dismissed Geography')
  })

  it('explains capture on the first day', async () => {
    render('empty')
    expect(await screen.findByText('Nothing captured yet')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Suggested subjects' })).toBeNull()
  })

  it('shows specific loading copy while the inbox loads', () => {
    render('slow')
    expect(
      screen
        .getAllByRole('status')
        .map((s) => s.textContent)
        .join(' '),
    ).toContain('Gathering what Dumbledore noticed while you studied…')
  })

  it('shows an error with a retry when the inbox fails to load', async () => {
    render('error')
    expect(await screen.findByText('Couldn’t load your memory')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })
})
