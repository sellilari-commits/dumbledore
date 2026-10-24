/**
 * Quiz card beside the orb (380 pt): checkpoint, review or exam questions one at a time with
 * instant feedback, "n of N" dots, then the score and "Fix my gaps". Keys: 1–4 pick, Enter next,
 * Esc close (when main routes keys to the overlay; mouse works everywhere).
 */
import type { DumbledoreApi } from '@shared/ipc'
import { X } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { type Anchor, anchorStyle } from '../lib/layout'
import { QuestionView } from './QuestionView'
import { ResultView } from './ResultView'
import { type Mark, useQuiz } from './useQuiz'
import './quiz.css'

export const QUIZ_WIDTH = 380

interface Props {
  api: DumbledoreApi
  quizId: string
  anchor: Anchor
  onClose: () => void
}

export function QuizCard({ api, quizId, anchor, onClose }: Props) {
  const ctl = useQuiz(api, quizId)
  const { quiz, view } = ctl
  const primary = useRef<(() => void) | null>(null)
  const total = quiz?.questions.length ?? 0
  const question = view.kind === 'question' ? quiz?.questions[view.index] : undefined

  if (view.kind === 'question') primary.current = view.feedback ? ctl.next : null
  else if (view.kind === 'error') primary.current = ctl.retry
  else if (view.kind !== 'result') primary.current = null

  const keys = useRef({ ctl, onClose })
  keys.current = { ctl, onClose }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return
      if (e.key === 'Escape') {
        e.preventDefault()
        keys.current.onClose()
      } else if (/^[1-4]$/.test(e.key)) {
        keys.current.ctl.pick(Number(e.key) - 1)
      } else if (e.key === 'Enter') {
        e.preventDefault()
        primary.current?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const title = quiz?.title ?? 'Quiz'
  return (
    <section
      className="ov-sat ov-quiz"
      data-hit=""
      data-testid="quiz-card"
      aria-label={title}
      style={anchorStyle(anchor)}
    >
      <header className="ov-quiz__head">
        <span className="ov-quiz__title">{title}</span>
        <button type="button" className="ov-icon-btn" aria-label="Close quiz" onClick={onClose}>
          <X size={15} strokeWidth={1.75} aria-hidden />
        </button>
      </header>

      <div className="ov-quiz__body">
        {view.kind === 'loading' && <Loading generating={view.generating} />}
        {view.kind === 'finishing' && <Loading generating={false} label="Scoring your answers…" />}
        {view.kind === 'error' && (
          <div className="ov-quiz__fail">
            <p>{view.message}</p>
            <button type="button" className="ov-btn" onClick={ctl.retry}>
              Try again
            </button>
          </div>
        )}
        {view.kind === 'question' && question && (
          <QuestionView
            question={question}
            picked={view.picked}
            feedback={view.feedback}
            error={view.error}
            onPick={ctl.pick}
          />
        )}
        {view.kind === 'result' && (
          <ResultView api={api} result={view.result} onDone={onClose} primaryRef={primary} />
        )}
      </div>

      {view.kind === 'question' && (
        <footer className="ov-quiz__foot">
          <Dots marks={ctl.marks} current={view.index} />
          <span className="ov-quiz__count">
            {view.index + 1} of {total}
          </span>
          {view.feedback ? (
            <button type="button" className="ov-btn ov-btn--primary" onClick={ctl.next}>
              {view.index + 1 < total ? 'Next' : 'See results'}
              <kbd className="ov-quiz__enter" aria-hidden>
                ↵
              </kbd>
            </button>
          ) : (
            <span className="ov-quiz__hint">Pick 1–4</span>
          )}
        </footer>
      )}
    </section>
  )
}

function Dots({ marks, current }: { marks: Mark[]; current: number }) {
  return (
    <span className="ov-dots" aria-hidden>
      {marks.map((mark, i) => (
        <span
          // biome-ignore lint/suspicious/noArrayIndexKey: one dot per question position
          key={i}
          className="ov-dots__dot"
          data-mark={mark ?? undefined}
          data-current={i === current || undefined}
        />
      ))}
    </span>
  )
}

function Loading({ generating, label }: { generating: boolean; label?: string }) {
  return (
    <div className="ov-quiz__loading" role="status">
      <span className="ov-skel" />
      <span className="ov-skel ov-skel--short" />
      <p>{label ?? (generating ? 'Writing your questions…' : 'Loading the quiz…')}</p>
    </div>
  )
}
