/**
 * Taking an exam: header with the meta line, a sticky "3 of 10 answered" strip, one block per
 * question (instant feedback + rationale; keys 1–4 answer the next open question) and
 * "Finish exam" once everything is answered → 'quiz.finish' → results.
 */
import { Button, Kbd, PageHeader, ProgressBar, QuizQuestion, toast } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { keys, useAction } from '@renderer/lib/queries'
import type { Question, Quiz } from '@shared/domain'
import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState } from 'react'
import { metaLine, minutesFor } from './exam-utils'
import { KindIcon } from './KindIcon'
import './exam-page.css'

export interface ExamTakingProps {
  quiz: Quiz
  /** "🧪 Organic Chemistry" */
  subjectLine: string
}

function scrollPageToTop(): void {
  const scroller = document.querySelector<HTMLElement>('.dd-app__scroll')
  scroller?.scrollTo?.({ top: 0 })
}

export function ExamTaking({ quiz, subjectLine }: ExamTakingProps) {
  const qc = useQueryClient()
  const [pending, setPending] = useState<Record<string, number>>({})
  const answers = new Map(quiz.answers.map((a) => [a.questionId, a]))
  const total = quiz.questions.length
  const answered = quiz.questions.filter((q) => answers.has(q.id)).length
  const allAnswered = total > 0 && answered === total
  const nextOpen = quiz.questions.find((q) => !answers.has(q.id) && pending[q.id] === undefined)

  const finish = useAction('quiz.finish', {
    onSuccess: (result) => {
      qc.setQueryData(['quiz.finish', quiz.id], result)
      qc.setQueryData<Quiz>(keys.quiz(quiz.id), (old) =>
        old
          ? { ...old, status: 'done', score: result.score, completedAt: new Date().toISOString() }
          : old,
      )
      scrollPageToTop()
    },
    onError: (err) => toast(err.message, { tone: 'error' }),
  })

  const choose = async (q: Question, optionIndex: number, viaKeyboard = false) => {
    if (answers.has(q.id) || pending[q.id] !== undefined) return
    setPending((p) => ({ ...p, [q.id]: optionIndex }))
    try {
      const res = await invoke('quiz.answer', {
        quizId: quiz.id,
        questionId: q.id,
        chosenIndex: optionIndex,
      })
      qc.setQueryData<Quiz>(keys.quiz(quiz.id), (old) =>
        old
          ? {
              ...old,
              status: old.status === 'ready' ? 'in_progress' : old.status,
              answers: [
                ...old.answers.filter((a) => a.questionId !== q.id),
                {
                  questionId: q.id,
                  chosenIndex: optionIndex,
                  correct: res.correct,
                  answeredAt: new Date().toISOString(),
                },
              ],
            }
          : old,
      )
      if (viaKeyboard) {
        const i = quiz.questions.findIndex((x) => x.id === q.id)
        const next = quiz.questions[i + 1]
        if (next)
          requestAnimationFrame(() =>
            document
              .getElementById(`exam-q-${next.id}`)
              ?.scrollIntoView({ block: 'start', behavior: 'smooth' }),
          )
      }
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Couldn’t save that answer.', { tone: 'error' })
    } finally {
      setPending((p) => {
        const { [q.id]: _done, ...rest } = p
        return rest
      })
    }
  }

  // Keys 1–4 answer the first open question (ignored while typing or when a dialog is open).
  const keyTarget = useRef<{ q: Question | undefined; choose: typeof choose }>({
    q: nextOpen,
    choose,
  })
  keyTarget.current = { q: nextOpen, choose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return
      if (document.querySelector('[role="dialog"]')) return
      const n = Number(e.key)
      const { q, choose: pick } = keyTarget.current
      if (!q || !Number.isInteger(n) || n < 1 || n > 4) return
      e.preventDefault()
      void pick(q, n - 1, true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const left = total - answered
  return (
    <>
      <PageHeader
        icon={<KindIcon kind={quiz.kind} size={44} />}
        title={quiz.title}
        subtitle={metaLine([`${total} questions`, subjectLine, `about ${minutesFor(total)} min`])}
      >
        <div className="ex-tip">
          Pick an answer to see why it’s right or wrong. Keys
          <span className="ex-tip__keys">
            <Kbd boxed>1</Kbd>–<Kbd boxed>4</Kbd>
          </span>
          work too.
        </div>
      </PageHeader>

      <div className="ex-strip" role="status" aria-live="polite">
        <span className="ex-strip__label">
          {answered} of {total} answered
        </span>
        <ProgressBar value={total ? answered / total : 0} color="blue" label="Exam progress" />
      </div>

      <div className="ex-questions">
        {quiz.questions.map((q, i) => {
          const a = answers.get(q.id)
          const chosen = a?.chosenIndex ?? pending[q.id] ?? null
          return (
            <div key={q.id} id={`exam-q-${q.id}`} className="ex-question">
              <QuizQuestion
                index={i}
                total={total}
                question={q}
                chosenIndex={chosen}
                result={a ? { correct: a.correct, correctIndex: q.correctIndex } : null}
                disabled={pending[q.id] !== undefined}
                showKeys={nextOpen?.id === q.id}
                onAnswer={(opt) => void choose(q, opt)}
              />
            </div>
          )
        })}
      </div>

      <div className="ex-finish">
        <Button
          variant="primary"
          disabled={!allAnswered}
          loading={finish.isPending}
          onClick={() => finish.mutate(quiz.id)}
        >
          Finish exam
        </Button>
        <span className="ex-finish__note">
          {allAnswered
            ? 'All answered — see your score and gaps.'
            : `${left} question${left === 1 ? '' : 's'} left`}
        </span>
      </div>
    </>
  )
}
