/**
 * One quiz question: the stem, four Notion radio rows (keys 1–4) and, once answered, green/red
 * rows plus the rationale. Rows are buttons — picking one is the answer — so no typing and no
 * keyboard focus is ever needed.
 */
import type { AnswerResult, Question } from '@shared/domain'
import { Check, X } from 'lucide-react'

interface Props {
  question: Question
  picked: number | null
  feedback: AnswerResult | null
  error: string | null
  onPick: (choice: number) => void
}

type RowState = 'idle' | 'picked' | 'correct' | 'wrong' | 'dim'

const STATE_SUFFIX: Record<RowState, string> = {
  idle: '',
  picked: '',
  correct: ' (correct answer)',
  wrong: ' (your answer, wrong)',
  dim: '',
}

function rowState(i: number, picked: number | null, feedback: AnswerResult | null): RowState {
  if (!feedback) return picked === i ? 'picked' : 'idle'
  if (i === feedback.correctIndex) return 'correct'
  if (i === picked) return 'wrong'
  return 'dim'
}

export function QuestionView({ question, picked, feedback, error, onPick }: Props) {
  const stemId = `ov-q-${question.id}`
  const locked = feedback !== null || picked !== null
  return (
    <div className="ov-quiz__question">
      <p className="ov-quiz__stem" id={stemId}>
        {question.stem}
      </p>
      <fieldset className="ov-quiz__options" aria-labelledby={stemId}>
        {question.options.map((option, i) => {
          const state = rowState(i, picked, feedback)
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: options are positional (keys 1–4)
              key={i}
              type="button"
              aria-label={`${i + 1}. ${option}${STATE_SUFFIX[state]}`}
              aria-pressed={picked === i}
              aria-disabled={locked || undefined}
              className="ov-opt"
              data-state={state}
              data-testid="quiz-option"
              onClick={() => {
                if (!locked) onPick(i)
              }}
            >
              <kbd className="ov-key ov-opt__key" aria-hidden>
                {i + 1}
              </kbd>
              <span className="ov-opt__text">{option}</span>
              {state === 'correct' && <Check className="ov-opt__mark" size={16} aria-hidden />}
              {state === 'wrong' && <X className="ov-opt__mark" size={16} aria-hidden />}
            </button>
          )
        })}
      </fieldset>
      {feedback && (
        <div className="ov-quiz__why" data-correct={feedback.correct} aria-live="polite">
          <strong>{feedback.correct ? 'Correct.' : 'Not quite.'}</strong> {feedback.rationale}
        </div>
      )}
      {error && (
        <p className="ov-quiz__error" role="alert">
          {error}
        </p>
      )}
    </div>
  )
}
