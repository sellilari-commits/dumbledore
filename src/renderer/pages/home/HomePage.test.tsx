/**
 * Home against the mock API: every section with demo data, the actions (open a roadmap, resume,
 * Start 5-min review, Study this, Add deadline) and the first-day / loading / error states.
 */
import { useToasts } from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { renderWithApp } from '@renderer/lib/test-utils'
import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { HomePage } from './HomePage'

const toasts = () => useToasts.getState().toasts.map((t) => t.text)

beforeEach(() => {
  useShell.setState({ newSubjectOpen: false })
  useToasts.setState({ toasts: [] })
})

describe('HomePage', () => {
  it('greets by name and shows every section', async () => {
    renderWithApp(<HomePage />)
    expect(
      await screen.findByRole('heading', { name: /^Good (morning|afternoon|evening), Ilari$/ }),
    ).toBeTruthy()
    expect(screen.getByText(/3 reviews due/)).toBeTruthy()

    const cont = screen.getByRole('region', { name: 'Continue' })
    expect(within(cont).getByRole('link', { name: 'SN1 vs SN2' })).toBeTruthy()
    expect(within(cont).getByText('3/8')).toBeTruthy()

    const review = screen.getByRole('region', { name: /Due for review/ })
    expect(within(review).getByText('Leaving groups')).toBeTruthy()
    expect(within(review).getByText('Determinants')).toBeTruthy()

    const struggling = screen.getByRole('region', { name: 'Struggling with' })
    expect(within(struggling).getByText('Missed 3 times recently')).toBeTruthy()

    const deadlines = screen.getByRole('region', { name: 'Upcoming deadlines' })
    expect(within(deadlines).getByText('Problem set 4')).toBeTruthy()
    expect(within(deadlines).getByText('in 6 days')).toBeTruthy()

    const week = screen.getByRole('region', { name: 'This week' })
    expect(within(week).getByText('3 h 55 min')).toBeTruthy()
    expect(within(week).getByText('23')).toBeTruthy()
    expect(within(week).getByText('70%')).toBeTruthy()

    const habits = screen.getByRole('region', { name: 'Prompting habits' })
    expect(within(habits).getByText('34%')).toBeTruthy()
    expect(within(habits).getByText('Ask to be quizzed.')).toBeTruthy()
  })

  it('opens a roadmap from its card and resumes a paused one', async () => {
    const r = renderWithApp(<HomePage />)
    fireEvent.click(await screen.findByRole('link', { name: 'SN1 vs SN2' }))
    expect(r.history.at(-1)).toBe('/subjects/sub_orgo/roadmap')

    fireEvent.click(screen.getByRole('button', { name: 'Resume Eigenvalues from scratch' }))
    await waitFor(() => expect(r.api.db.sessionRoadmapId).toBe('rm_linalg'))
    await waitFor(() => expect(toasts()[0]).toMatch(/^Resumed at step 3 of 6/))
  })

  it('starts a 5-minute review of everything due', async () => {
    const r = renderWithApp(<HomePage />)
    const before = r.api.db.quizzes.length
    fireEvent.click(await screen.findByRole('button', { name: 'Start 5-min review' }))
    await waitFor(() => expect(r.api.db.quizzes.length).toBe(before + 1))
    expect(r.api.db.quizzes.at(-1)?.title).toMatch(/^Due reviews/)
  })

  it('builds a roadmap for something you struggle with', async () => {
    const r = renderWithApp(<HomePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Study Eigenvalues & eigenvectors' }))
    await waitFor(() =>
      expect(r.api.db.roadmaps.some((m) => m.title === 'Eigenvalues & eigenvectors')).toBe(true),
    )
  })

  it('adds a deadline inline', async () => {
    const r = renderWithApp(<HomePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add deadline' }))
    const add = screen.getByRole('button', { name: 'Add' })
    expect((add as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Deadline title'), { target: { value: 'Essay draft' } })
    fireEvent.change(screen.getByLabelText('Due date'), { target: { value: '2026-11-20' } })
    fireEvent.keyDown(screen.getByRole('button', { name: 'Subject' }), { key: 'Enter' })
    fireEvent.click(await screen.findByRole('menuitem', { name: /Organic Chemistry/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Add' }))
    await waitFor(() =>
      expect(r.api.db.assignments.find((a) => a.title === 'Essay draft')?.subjectId).toBe(
        'sub_orgo',
      ),
    )
    expect(await screen.findByText('Essay draft')).toBeTruthy()
    expect(screen.queryByRole('form', { name: 'Add deadline' })).toBeNull()
  })

  it('cancels the add-deadline row with Escape', async () => {
    renderWithApp(<HomePage />)
    fireEvent.click(await screen.findByRole('button', { name: 'Add deadline' }))
    fireEvent.keyDown(screen.getByLabelText('Deadline title'), { key: 'Escape' })
    expect(screen.queryByLabelText('Deadline title')).toBeNull()
  })

  it('guides a first day with first steps instead of empty sections', async () => {
    renderWithApp(<HomePage />, { scenario: 'empty' })
    expect(await screen.findByText('Let’s get started')).toBeTruthy()
    expect(await screen.findByRole('region', { name: 'First steps' })).toBeTruthy()
    expect(screen.getByText('0 of 4 done')).toBeTruthy()
    expect(screen.queryByRole('region', { name: 'Continue' })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Add a subject' }))
    expect(useShell.getState().newSubjectOpen).toBe(true)
  })

  it('shows specific loading copy while Home loads', () => {
    renderWithApp(<HomePage />, { scenario: 'slow' })
    expect(screen.getByRole('status').textContent).toContain(
      'Gathering your roadmaps, reviews and deadlines…',
    )
  })

  it('shows an error with a retry when Home fails to load', async () => {
    renderWithApp(<HomePage />, { scenario: 'error' })
    expect(await screen.findByText('Couldn’t load Home')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })
})
