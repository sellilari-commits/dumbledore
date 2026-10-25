/**
 * Exam page: instant feedback per answer, keys 1–4, finishing into results, results of a
 * finished exam (gaps + prompt actions), and the "being written" state.
 */
import { useToasts } from '@renderer/design-system'
import { useShell } from '@renderer/lib/shell'
import { renderWithApp } from '@renderer/lib/test-utils'
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Route } from 'wouter'
import { ExamPage } from './ExamPage'

beforeEach(() => {
  useShell.setState({ newExam: { open: false, subjectIds: [] } })
  useToasts.setState({ toasts: [] })
})

function renderExam(id: string) {
  return renderWithApp(<Route path="/exams/:id" component={ExamPage} />, { route: `/exams/${id}` })
}

async function pick(name: RegExp) {
  fireEvent.click(await screen.findByRole('radio', { name }))
}

describe('ExamPage — taking', () => {
  it('reveals right and wrong answers with their rationale', async () => {
    renderExam('quiz_linalg_ready')
    expect(await screen.findByText('If Av = 3v for a non-zero vector v, then…')).toBeTruthy()
    expect(screen.getByText('0 of 5 answered')).toBeTruthy()

    await pick(/^v is an eigenvector with eigenvalue 3/)
    expect(await screen.findByText('Correct.')).toBeTruthy()
    expect(screen.getByText('Right: that is the definition of an eigenpair.')).toBeTruthy()

    await pick(/^0 and 7/)
    expect(await screen.findByText('Not quite.')).toBeTruthy()
    expect(screen.getByText('7 is the trace, not an eigenvalue.')).toBeTruthy()
    expect(
      screen.getByText('Right: a diagonal matrix has its eigenvalues on the diagonal.'),
    ).toBeTruthy()
    expect(await screen.findByText('2 of 5 answered')).toBeTruthy()
  })

  it('answers the next open question with keys 1–4', async () => {
    const r = renderExam('quiz_linalg_ready')
    await screen.findByText('If Av = 3v for a non-zero vector v, then…')
    fireEvent.keyDown(window, { key: '1' })
    expect(await screen.findByText('1 of 5 answered')).toBeTruthy()
    const quiz = r.api.db.quizzes.find((q) => q.id === 'quiz_linalg_ready')
    expect(quiz?.answers[0]).toMatchObject({ questionId: 'q_l1', chosenIndex: 0, correct: true })
  })

  it('finishes into a score, a by-topic table and the gaps', async () => {
    const r = renderExam('quiz_linalg_ready')
    const finish = await screen.findByRole('button', { name: /finish exam/i })
    expect((finish as HTMLButtonElement).disabled).toBe(true)

    await pick(/^v is an eigenvector/)
    await screen.findByText('1 of 5 answered')
    await pick(/^2 and 5/)
    await screen.findByText('2 of 5 answered')
    await pick(/^A is invertible/)
    await screen.findByText('3 of 5 answered')
    await pick(/^always linearly dependent/)
    await screen.findByText('4 of 5 answered')
    await pick(/^2×4/)
    await screen.findByText('5 of 5 answered')

    fireEvent.click(screen.getByRole('button', { name: /finish exam/i }))
    expect(await screen.findByText('4 / 5')).toBeTruthy()
    expect(screen.getByText('80%')).toBeTruthy()
    expect(screen.getByRole('table', { name: 'Score by topic' })).toBeTruthy()
    expect(screen.getByText('Your gaps')).toBeTruthy()
    expect(screen.getByText(/you picked “A is invertible”/)).toBeTruthy()
    expect(r.api.db.quizzes.find((q) => q.id === 'quiz_linalg_ready')?.status).toBe('done')
  })
})

describe('ExamPage — results and states', () => {
  it('shows a finished exam with its gaps and prompt actions', async () => {
    renderExam('quiz_orgo_weak')
    expect(await screen.findByText('7 / 10')).toBeTruthy()
    expect(screen.getByText('70%')).toBeTruthy()
    expect(screen.getByText('Your gaps')).toBeTruthy()
    expect(screen.getByText(/you picked “DMSO”/)).toBeTruthy()
    expect(screen.getByText(/Next up:/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /copy prompt/i }))
    expect(await screen.findByText('Prompt copied — paste it into ChatGPT')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: /explore with chatgpt/i }))
    expect(await screen.findByText(/Pasted into ChatGPT/)).toBeTruthy()

    fireEvent.click(screen.getByRole('button', { name: /review your answers/i }))
    expect(screen.getByText('Which carbocation is the most stable?')).toBeTruthy()
  })

  it('groups gaps per concept and opens the review at a gap’s question', async () => {
    renderExam('quiz_orgo_weak')
    const carbo = await screen.findByText(/you picked “The cationic carbon becomes sp³” and/)
    expect(carbo.closest('li')?.textContent).toMatch(/^Carbocation stability/)
    const refs = screen.getAllByRole('button', { name: /^Show question \d+$/ })
    expect(refs.length).toBe(3)
    expect(screen.queryByText('Which carbocation is the most stable?')).toBeNull()
    fireEvent.click(refs[0] as HTMLElement)
    const toggle = screen.getByRole('button', { name: /review your answers/i })
    expect(toggle.getAttribute('aria-expanded')).toBe('true')
    expect(screen.getByText('Which carbocation is the most stable?')).toBeTruthy()
  })

  it('with no AI chat open opens nothing, says so and offers Copy', async () => {
    const r = renderExam('quiz_orgo_weak')
    r.api.db.appState.aiChat = null
    const invoke = vi.spyOn(r.api, 'invoke')
    fireEvent.click(await screen.findByRole('button', { name: /explore with/i }))
    const choice = await screen.findByRole('group', { name: 'No AI chat open' })
    expect(within(choice).getByText('No AI chat is open.')).toBeTruthy()
    expect(within(choice).queryByRole('button', { name: /^Open / })).toBeNull()
    fireEvent.click(within(choice).getByRole('button', { name: 'Copy' }))
    expect(await screen.findByText('Prompt copied — paste it into your AI')).toBeTruthy()
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain('prompt.openUsualAi')
  })

  it('opens the usual AI only on a click of "Open ChatGPT and paste"', async () => {
    const r = renderExam('quiz_orgo_weak')
    r.api.db.appState.aiChat = null
    r.api.db.appState.assistant = { key: 'chatgpt', name: 'ChatGPT', open: false }
    const invoke = vi.spyOn(r.api, 'invoke')
    fireEvent.click(await screen.findByRole('button', { name: /explore with/i }))
    const choice = await screen.findByRole('group', { name: 'No AI chat open' })
    expect(within(choice).getByText('ChatGPT isn’t open.')).toBeTruthy()
    expect(invoke.mock.calls.map((c) => c[0])).not.toContain('prompt.openUsualAi')
    fireEvent.click(within(choice).getByRole('button', { name: 'Open ChatGPT and paste' }))
    expect(
      await screen.findByText('Opened ChatGPT — your prompt is copied: paste it with ⌘V.'),
    ).toBeTruthy()
    const opened = invoke.mock.calls.filter((c) => c[0] === 'prompt.openUsualAi')
    expect(opened).toHaveLength(1)
    expect(String(opened[0]?.[1])).toContain('Organic Chemistry')
    expect(screen.queryByRole('group', { name: 'No AI chat open' })).toBeNull()
  })

  it('says what it is writing, then shows the questions', async () => {
    const r = renderExam('quiz_linalg_ready')
    await screen.findByText('If Av = 3v for a non-zero vector v, then…')
    const quiz = await r.api.invoke('exams.create', {
      subjectIds: ['sub_orgo'],
      count: 5,
      focus: 'everything',
      difficulty: 'mixed',
    })
    act(() => r.navigate(`/exams/${quiz.id}`))
    expect(await screen.findByText('Writing 5 questions on Organic Chemistry…')).toBeTruthy()
    expect(
      await screen.findByText('Which carbocation is the most stable?', {}, { timeout: 4000 }),
    ).toBeTruthy()
  })

  it('shows an error for an exam that does not exist', async () => {
    renderExam('quiz_missing')
    expect(await screen.findByText('Couldn’t open this exam')).toBeTruthy()
    await waitFor(() => expect(screen.getByText('That exam no longer exists.')).toBeTruthy())
  })
})
