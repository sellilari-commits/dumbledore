/** New exam dialog: default subject, the chosen count/focus reach 'exams.create', navigation. */
import { useToasts } from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { renderWithApp } from '@renderer/lib/test-utils'
import { act, fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { NewExamDialog } from './NewExamDialog'

beforeEach(() => {
  useShell.setState({ newExam: { open: false, subjectIds: [] } })
  useToasts.setState({ toasts: [] })
})

const checkbox = (name: RegExp) => screen.getByRole('checkbox', { name }) as HTMLInputElement

describe('NewExamDialog', () => {
  it('starts from the focus subject and creates the exam that was asked for', async () => {
    const r = renderWithApp(<NewExamDialog />, { route: '/exams' })
    act(() => useShell.getState().openNewExam())
    await screen.findByRole('checkbox', { name: /organic chemistry/i })
    await waitFor(() => expect(checkbox(/organic chemistry/i).checked).toBe(true))
    expect(checkbox(/linear algebra/i).checked).toBe(false)

    fireEvent.click(screen.getByRole('radio', { name: '5' }))
    fireEvent.click(screen.getByRole('radio', { name: /due for review/i }))
    expect(screen.getByText('About 4 min')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /create exam/i }))

    await waitFor(() => expect(r.history.at(-1)).toMatch(/^\/exams\/quiz_/))
    const created = r.api.db.quizzes.at(-1)
    expect(created?.title).toBe('Due reviews · Organic Chemistry')
    expect(created?.subjectIds).toEqual(['sub_orgo'])
    expect(created?.questions).toHaveLength(5)
    expect(useShell.getState().newExam.open).toBe(false)
  })

  it('preselects the subjects it was opened with and can mix subjects', async () => {
    const r = renderWithApp(<NewExamDialog />, { route: '/subjects/sub_linalg/exams' })
    act(() => useShell.getState().openNewExam(['sub_linalg']))
    await screen.findByRole('checkbox', { name: /linear algebra/i })
    await waitFor(() => expect(checkbox(/linear algebra/i).checked).toBe(true))
    expect(checkbox(/organic chemistry/i).checked).toBe(false)

    fireEvent.click(checkbox(/organic chemistry/i))
    fireEvent.click(screen.getByRole('radio', { name: /^everything/i }))
    fireEvent.click(screen.getByRole('button', { name: /create exam/i }))
    await waitFor(() => expect(r.history.at(-1)).toMatch(/^\/exams\/quiz_/))
    const created = r.api.db.quizzes.at(-1)
    expect(created?.subjectIds).toEqual(['sub_orgo', 'sub_linalg'])
    expect(created?.title).toBe('Everything · Organic Chemistry + Linear Algebra')
    expect(created?.questions).toHaveLength(10)
  })

  it('cannot create an exam without a subject', async () => {
    renderWithApp(<NewExamDialog />)
    act(() => useShell.getState().openNewExam())
    await waitFor(() => expect(checkbox(/organic chemistry/i).checked).toBe(true))
    fireEvent.click(checkbox(/organic chemistry/i))
    const create = screen.getByRole('button', { name: /create exam/i }) as HTMLButtonElement
    expect(create.disabled).toBe(true)
  })
})
