/**
 * Earlier versions on the subject page against the mock API: the quiet toggle under Progress,
 * the versions with their reason and steps done, opening one read-only, "Bring back" (and
 * bringing the replaced one back again to undo it), and nothing at all without a history.
 */
import { useToasts } from '@renderer/design-system'
import type { MockScenario } from '@renderer/lib/mock/db'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { Route } from 'wouter'
import { SubjectPage } from './SubjectPage'

beforeEach(() => useToasts.setState({ toasts: [] }))

function renderSubject(route = '/subjects/sub_orgo/roadmap', scenario: MockScenario = 'demo') {
  return renderWithApp(<Route path="/subjects/:id/:view" component={SubjectPage} />, {
    route,
    scenario,
  })
}

const toastTexts = () => useToasts.getState().toasts.map((t) => t.text)

async function openHistory(count = 2) {
  const progress = await screen.findByRole('region', { name: 'Progress' })
  fireEvent.click(
    await within(progress).findByRole('button', { name: `Earlier versions (${count})` }),
  )
  return within(progress).getByRole('list', { name: 'Earlier versions' })
}

describe('RoadmapHistory', () => {
  it('lists the earlier versions with why they were replaced and how far they got', async () => {
    renderSubject()
    const list = await openHistory()
    const rows = within(list).getAllByRole('listitem')
    expect(rows.length).toBe(2)
    expect(within(rows[0] as HTMLElement).getByText('Substitution basics')).toBeTruthy()
    expect(
      within(rows[0] as HTMLElement).getByText(/Replanned: focus on SN1, skip E2 · 2 of 6 steps/),
    ).toBeTruthy()
    expect(within(rows[1] as HTMLElement).getByText('Organic chemistry from scratch')).toBeTruthy()
    expect(
      within(rows[1] as HTMLElement).getByText(/New roadmap: Pass the midterm · 1 of 5 steps/),
    ).toBeTruthy()
  })

  it('opens a version read-only: its steps as they were, no step actions', async () => {
    renderSubject()
    const list = await openHistory()
    fireEvent.click(within(list).getByRole('button', { name: 'Open Substitution basics' }))
    const steps = within(list).getByRole('list', { name: 'Steps of Substitution basics' })
    const items = within(steps).getAllByRole('listitem')
    expect(items.length).toBe(6)
    expect(items[0]?.textContent).toContain('Nucleophiles & electrophiles')
    expect(items[0]?.textContent).toContain('Done')
    expect(items[2]?.textContent).toContain('You were here')
    expect(within(steps).queryByRole('button')).toBeNull()
    fireEvent.click(within(list).getByRole('button', { name: 'Hide Substitution basics' }))
    expect(within(list).queryByRole('list', { name: 'Steps of Substitution basics' })).toBeNull()
  })

  it('brings a version back, keeps the replaced one, and bringing that back undoes it', async () => {
    const r = renderSubject()
    let list = await openHistory()
    fireEvent.click(within(list).getByRole('button', { name: 'Bring back Substitution basics' }))
    await waitFor(() =>
      expect(toastTexts()).toContain(
        'Brought back “Substitution basics”. The newer one is under Earlier versions.',
      ),
    )
    const progress = screen.getByRole('region', { name: 'Progress' })
    expect(await within(progress).findByText('Substitution basics')).toBeTruthy()
    expect(within(progress).getByText(/Step 3 of 6/)).toBeTruthy()
    list = within(progress).getByRole('list', { name: 'Earlier versions' })
    await waitFor(() => expect(within(list).getByText('SN1 vs SN2')).toBeTruthy())
    expect(within(list).getByText(/Swapped for an earlier version · 2 of 8 steps/)).toBeTruthy()
    expect(within(list).queryByText('Substitution basics')).toBeNull()
    expect(r.api.db.sessionRoadmapId).toBe('rm_orgo_basics')

    // Undo: the replaced roadmap comes back with its steps as they were.
    fireEvent.click(within(list).getByRole('button', { name: 'Bring back SN1 vs SN2' }))
    expect(await within(progress).findByText(/Step 3 of 8/)).toBeTruthy()
    expect(within(progress).getByText('SN1 vs SN2')).toBeTruthy()
    await waitFor(() => expect(within(list).getByText('Substitution basics')).toBeTruthy())
    expect(within(list).getAllByRole('listitem').length).toBe(2)
    expect(r.api.db.sessionRoadmapId).toBe('rm_orgo')
    expect(r.api.db.roadmaps.filter((x) => x.subjectId === 'sub_orgo').length).toBe(1)
  })

  it('says when an earlier version is gone', async () => {
    const r = renderSubject()
    const list = await openHistory()
    await expect(r.api.invoke('roadmaps.restore', 'rm_nope')).rejects.toThrow(
      'That earlier version no longer exists.',
    )
    expect(within(list).getAllByRole('listitem').length).toBe(2)
  })

  it('shows nothing for a subject without earlier versions', async () => {
    renderSubject('/subjects/sub_linalg/roadmap')
    const progress = await screen.findByRole('region', { name: 'Progress' })
    await new Promise((r) => setTimeout(r, 50))
    expect(within(progress).queryByRole('button', { name: /Earlier versions/ })).toBeNull()
  })
})
