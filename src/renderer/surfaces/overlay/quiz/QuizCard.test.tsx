import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { answerOf, demoQuiz, QUESTIONS, resultOf } from '../mock/fixtures'
import { fakeApi } from '../testing/fakeApi'
import { QuizCard } from './QuizCard'
import { sentNote } from './ResultView'

const anchor = { left: 10, top: 10, origin: 'right top' }

function quizApi(overrides: Parameters<typeof fakeApi>[0] = {}) {
  const answers = new Map<string, number>()
  return fakeApi({
    'quiz.get': (id) => demoQuiz(id, answers),
    'quiz.answer': ({ questionId, chosenIndex }) => {
      answers.set(questionId, chosenIndex)
      return answerOf(questionId, chosenIndex)
    },
    'quiz.finish': (id) => resultOf(id, answers),
    'prompt.sendToChat': () => ({ ok: true, reason: null }),
    ...overrides,
  })
}

async function mount(local = quizApi()) {
  const onClose = vi.fn()
  render(<QuizCard api={local.api} quizId="quiz_1" anchor={anchor} onClose={onClose} />)
  await screen.findByText(QUESTIONS[0]?.stem ?? '')
  return { local, onClose }
}

const flush = () => act(async () => {})
const key = (k: string) => fireEvent.keyDown(window, { key: k })

afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('QuizCard', () => {
  it('shows one question with four radio rows and "1 of 4"', async () => {
    await mount()
    expect(screen.getAllByTestId('quiz-option')).toHaveLength(4)
    expect(screen.getByText('1 of 4')).toBeTruthy()
    expect(screen.getByText('Pick 1–4')).toBeTruthy()
  })

  it('answers through quiz.answer and shows instant feedback', async () => {
    const { local } = await mount()
    fireEvent.click(screen.getAllByTestId('quiz-option')[2] as HTMLElement)
    await flush()
    expect(local.calls.find((c) => c.channel === 'quiz.answer')?.payload).toEqual({
      quizId: 'quiz_1',
      questionId: 'q1',
      chosenIndex: 2,
    })
    const rows = screen.getAllByTestId('quiz-option')
    expect(rows.map((r) => r.dataset.state)).toEqual(['dim', 'dim', 'wrong', 'correct'])
    expect(screen.getByText('Not quite.')).toBeTruthy()
    // A second pick after feedback is ignored.
    fireEvent.click(rows[0] as HTMLElement)
    expect(local.calls.filter((c) => c.channel === 'quiz.answer')).toHaveLength(1)
  })

  it('runs on keys alone: 1–4, Enter, then the result, Fix my gaps and Esc', async () => {
    const { local, onClose } = await mount()
    for (const k of ['3', 'Enter', '1', 'Enter', '1', 'Enter', '2']) {
      key(k)
      await flush()
    }
    expect(screen.getByRole('button', { name: /See results/ })).toBeTruthy()
    key('Enter')
    await flush()
    expect(screen.getByText('One idea to fix.')).toBeTruthy()
    expect(screen.getByText('Struggling')).toBeTruthy()
    key('Enter') // primary = Fix my gaps
    await flush()
    const sendCall = local.calls.find((c) => c.channel === 'prompt.sendToChat')
    expect(String(sendCall?.payload)).toContain('Carbocation stability')
    expect(screen.getByText('Pasted into your chat')).toBeTruthy()
    key('Escape')
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it('with no AI chat open: says so, Enter opens nothing, only the Open button opens the AI', async () => {
    const local = quizApi({
      'prompt.sendToChat': () => ({
        ok: false,
        reason: 'no-chat',
        opened: null,
        usual: { name: 'ChatGPT' },
      }),
      'prompt.openUsualAi': () => ({ opened: { name: 'ChatGPT', prefilled: false } }),
    })
    await mount(local)
    for (const k of ['3', 'Enter', '1', 'Enter', '1', 'Enter', '2']) {
      key(k)
      await flush()
    }
    key('Enter') // See results
    await flush()
    key('Enter') // Fix my gaps
    await flush()
    expect(screen.getByText('ChatGPT isn’t open.')).toBeTruthy()
    key('Enter') // never opens a website
    await flush()
    expect(local.calls.some((c) => c.channel === 'prompt.openUsualAi')).toBe(false)
    fireEvent.click(screen.getByRole('button', { name: 'Open ChatGPT and paste' }))
    await flush()
    const opened = local.calls.filter((c) => c.channel === 'prompt.openUsualAi')
    expect(opened).toHaveLength(1)
    expect(String(opened[0]?.payload)).toContain('Carbocation stability')
    expect(screen.getByText('Opened ChatGPT · paste with ⌘V')).toBeTruthy()
  })

  it('with no AI chat open, Copy copies the fix prompt', async () => {
    const local = quizApi({
      'prompt.sendToChat': () => ({ ok: false, reason: 'no-chat', opened: null, usual: null }),
      'prompt.copy': () => undefined,
    })
    await mount(local)
    for (const k of ['3', 'Enter', '1', 'Enter', '1', 'Enter', '2', 'Enter', 'Enter']) {
      key(k)
      await flush()
    }
    expect(screen.getByText('No AI chat is open.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /^Open / })).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await flush()
    expect(local.calls.find((c) => c.channel === 'prompt.copy')?.payload).toContain(
      'Carbocation stability',
    )
    expect(screen.getByText('Copied · paste with ⌘V')).toBeTruthy()
  })

  it('resumes at the first unanswered question', async () => {
    const answers = new Map([['q1', 3]])
    const local = fakeApi({ 'quiz.get': (id) => demoQuiz(id, answers) })
    render(<QuizCard api={local.api} quizId="quiz_1" anchor={anchor} onClose={() => {}} />)
    expect(await screen.findByText(QUESTIONS[1]?.stem ?? '')).toBeTruthy()
    expect(screen.getByText('2 of 4')).toBeTruthy()
  })

  it('waits while the quiz is still being written', async () => {
    let calls = 0
    const local = fakeApi({
      'quiz.get': (id) => {
        calls++
        const q = demoQuiz(id, new Map())
        return calls === 1 ? { ...q, status: 'generating', questions: [] } : q
      },
    })
    vi.useFakeTimers({ shouldAdvanceTime: true })
    render(<QuizCard api={local.api} quizId="quiz_1" anchor={anchor} onClose={() => {}} />)
    await flush()
    expect(screen.getByText('Writing your questions…')).toBeTruthy()
    await act(async () => {
      vi.advanceTimersByTime(1600)
    })
    expect(await screen.findByText(QUESTIONS[0]?.stem ?? '')).toBeTruthy()
  })

  it('shows an error with a retry when loading fails', async () => {
    let fail = true
    const local = fakeApi({
      'quiz.get': (id) => {
        if (fail) throw new Error('Quiz not found')
        return demoQuiz(id, new Map())
      },
    })
    render(<QuizCard api={local.api} quizId="quiz_1" anchor={anchor} onClose={() => {}} />)
    expect(await screen.findByText('Quiz not found')).toBeTruthy()
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByText(QUESTIONS[0]?.stem ?? '')).toBeTruthy()
  })

  it('close button → onClose', async () => {
    const { onClose } = await mount()
    fireEvent.click(screen.getByRole('button', { name: 'Close quiz' }))
    expect(onClose).toHaveBeenCalled()
  })
})

describe('sentNote', () => {
  it('says where the fix prompt went', () => {
    expect(sentNote(null)).toBe('Pasted into your chat')
    expect(sentNote({ name: 'Claude', prefilled: true })).toBe('Opened Claude with the prompt')
    expect(sentNote({ name: 'ChatGPT', prefilled: false })).toBe('Opened ChatGPT · paste with ⌘V')
  })
})
