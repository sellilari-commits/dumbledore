/** Exams list: demo rows, opening an exam, New exam, and the empty / error states. */
import { useToasts } from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { renderWithApp } from '@renderer/lib/test-utils'
import { act, fireEvent, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { ExamsPage } from './ExamsPage'

beforeEach(() => {
  useShell.setState({ newExam: { open: false, subjectIds: [] }, newSubjectOpen: false })
  useToasts.setState({ toasts: [] })
})

describe('ExamsPage', () => {
  it('lists exams with type, score and subjects, and opens one on click', async () => {
    const r = renderWithApp(<ExamsPage />, { route: '/exams' })
    const row = await screen.findByText('Weak-spots exam')
    expect(screen.getByText('Due reviews')).toBeTruthy()
    expect(screen.getByText('Not taken')).toBeTruthy()
    expect(screen.getByText('7/10 · 70%')).toBeTruthy()
    expect(screen.getByText('1/3 · 33%')).toBeTruthy()
    expect(screen.getAllByText('Review').length).toBeGreaterThan(0)
    fireEvent.click(row)
    expect(r.history.at(-1)).toBe('/exams/quiz_orgo_weak')
  })

  it('opens the New exam dialog from the top bar', async () => {
    renderWithApp(<ExamsPage />, { route: '/exams' })
    await screen.findByText('Weak-spots exam')
    fireEvent.click(screen.getByRole('button', { name: /new exam/i }))
    expect(useShell.getState().newExam.open).toBe(true)
  })

  it('asks for a subject first on the first day', async () => {
    renderWithApp(<ExamsPage />, { route: '/exams', scenario: 'empty' })
    expect(await screen.findByText('No exams yet')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /new subject/i }))
    expect(useShell.getState().newSubjectOpen).toBe(true)
    expect(screen.queryByRole('button', { name: /new exam/i })).toBeNull()
  })

  it('offers one New exam button when there are subjects but no exams', async () => {
    const r = renderWithApp(<ExamsPage />, { route: '/exams' })
    await screen.findByText('Weak-spots exam')
    r.api.db.quizzes.splice(0)
    act(() => r.api.emit('memory.changed', { scope: 'quizzes', ids: [] }))
    expect(await screen.findByText('No exams yet')).toBeTruthy()
    const buttons = screen.getAllByRole('button', { name: /new exam/i })
    expect(buttons).toHaveLength(1)
    fireEvent.click(buttons[0] as HTMLElement)
    expect(useShell.getState().newExam.open).toBe(true)
  })

  it('shows an error with a retry when exams fail to load', async () => {
    renderWithApp(<ExamsPage />, { route: '/exams', scenario: 'error' })
    expect(await screen.findByText('Couldn’t load your exams')).toBeTruthy()
    expect(screen.getByRole('button', { name: /try again/i })).toBeTruthy()
  })

  it('shows specific loading copy while exams load', () => {
    renderWithApp(<ExamsPage />, { route: '/exams', scenario: 'slow' })
    expect(screen.getByRole('status').textContent).toContain('Loading your exams…')
  })
})
