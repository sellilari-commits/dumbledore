/**
 * Quiz card logic: fetch the quiz (`quiz.get`, polling while it is still being written), one
 * question at a time, instant feedback through `quiz.answer`, then `quiz.finish` for the score.
 * Resumes at the first unanswered question when a quiz was started earlier.
 */

import type { AnswerResult, Quiz, QuizResult } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import { useCallback, useEffect, useRef, useState } from 'react'
import { errorMessage } from '../lib/bridge'

export type Mark = 'correct' | 'wrong' | null

export type QuizView =
  | { kind: 'loading'; generating: boolean }
  | { kind: 'error'; message: string }
  | {
      kind: 'question'
      index: number
      picked: number | null
      feedback: AnswerResult | null
      error: string | null
    }
  | { kind: 'finishing' }
  | { kind: 'result'; result: QuizResult }

export interface QuizController {
  quiz: Quiz | null
  view: QuizView
  marks: Mark[]
  pick: (choice: number) => void
  /** Next question, or the result after the last one. */
  next: () => void
  retry: () => void
}

export const POLL_MS = 1500

export function useQuiz(api: DumbledoreApi, quizId: string): QuizController {
  const [quiz, setQuiz] = useState<Quiz | null>(null)
  const [view, setView] = useState<QuizView>({ kind: 'loading', generating: false })
  const [marks, setMarks] = useState<Mark[]>([])
  const [attempt, setAttempt] = useState(0)
  const busy = useRef(false)
  const viewRef = useRef(view)
  viewRef.current = view
  const quizRef = useRef(quiz)
  quizRef.current = quiz

  const finish = useCallback(() => {
    setView({ kind: 'finishing' })
    api
      .invoke('quiz.finish', quizId)
      .then((result) => setView({ kind: 'result', result }))
      .catch((error: unknown) => setView({ kind: 'error', message: errorMessage(error) }))
  }, [api, quizId])

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` re-runs the load on retry
  useEffect(() => {
    let alive = true
    let timer = 0
    const load = async () => {
      try {
        const q = await api.invoke('quiz.get', quizId)
        if (!alive) return
        if (q.status === 'failed') {
          setView({ kind: 'error', message: 'This quiz could not be written.' })
          return
        }
        if (q.status === 'generating' || q.questions.length === 0) {
          setView({ kind: 'loading', generating: true })
          timer = window.setTimeout(load, POLL_MS)
          return
        }
        const answered = new Map(q.answers.map((a) => [a.questionId, a.correct]))
        setQuiz(q)
        setMarks(q.questions.map((qq) => markOf(answered.get(qq.id))))
        const first = q.questions.findIndex((qq) => !answered.has(qq.id))
        if (first === -1) finish()
        else setView({ kind: 'question', index: first, picked: null, feedback: null, error: null })
      } catch (error) {
        if (alive) setView({ kind: 'error', message: errorMessage(error) })
      }
    }
    void load()
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [api, quizId, attempt, finish])

  const pick = useCallback(
    (choice: number) => {
      const v = viewRef.current
      const question = quizRef.current?.questions[v.kind === 'question' ? v.index : -1]
      if (v.kind !== 'question' || v.feedback || busy.current || !question) return
      if (choice < 0 || choice >= question.options.length) return
      busy.current = true
      setView({ ...v, picked: choice, error: null })
      api
        .invoke('quiz.answer', { quizId, questionId: question.id, chosenIndex: choice })
        .then((feedback) => {
          setView((cur) =>
            cur.kind === 'question' && cur.index === v.index ? { ...cur, feedback } : cur,
          )
          setMarks((m) => m.map((x, i) => (i === v.index ? markOf(feedback.correct) : x)))
        })
        .catch((error: unknown) => {
          setView((cur) =>
            cur.kind === 'question' && cur.index === v.index
              ? { ...cur, picked: null, error: errorMessage(error) }
              : cur,
          )
        })
        .finally(() => {
          busy.current = false
        })
    },
    [api, quizId],
  )

  const next = useCallback(() => {
    const v = viewRef.current
    const total = quizRef.current?.questions.length ?? 0
    if (v.kind !== 'question' || !v.feedback) return
    if (v.index + 1 < total) {
      setView({ kind: 'question', index: v.index + 1, picked: null, feedback: null, error: null })
    } else {
      finish()
    }
  }, [finish])

  const retry = useCallback(() => {
    setView({ kind: 'loading', generating: false })
    setAttempt((n) => n + 1)
  }, [])

  return { quiz, view, marks, pick, next, retry }
}

function markOf(correct: boolean | undefined): Mark {
  if (correct === undefined) return null
  return correct ? 'correct' : 'wrong'
}
