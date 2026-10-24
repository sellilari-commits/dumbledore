/**
 * QuizQuestion: one multiple-choice question as radio rows. Before answering the rows are
 * selectable (1–4 keys hinted); once a result is known the chosen row turns green or red,
 * the right answer turns green, and both show their rationale.
 */
import type { Question } from '@shared/domain'
import { CircleCheck, CircleX } from 'lucide-react'
import { cx } from '../cx'
import '../styles/learning.css'
import { RadioGroup, RadioRow, type RadioTone } from './RadioRow'
import { Tag } from './Tag'

export interface QuizResultView {
  correct: boolean
  correctIndex: number
}

export interface QuizQuestionProps {
  index: number
  total?: number
  question: Question
  chosenIndex: number | null
  result: QuizResultView | null
  onAnswer?: (optionIndex: number) => void
  disabled?: boolean
  showKeys?: boolean
  className?: string
}

const LETTERS = ['A', 'B', 'C', 'D']

export function QuizQuestion({
  index,
  total,
  question,
  chosenIndex,
  result,
  onAnswer,
  disabled,
  showKeys,
  className,
}: QuizQuestionProps) {
  const revealed = result !== null
  const toneFor = (i: number): RadioTone | undefined => {
    if (!result) return undefined
    if (i === result.correctIndex) return 'correct'
    if (i === chosenIndex) return 'wrong'
    return 'muted'
  }
  const hintFor = (i: number) =>
    result && (i === result.correctIndex || i === chosenIndex) ? question.rationales[i] : undefined
  const correctLetter = result ? LETTERS[result.correctIndex] : ''
  return (
    <div className={cx('dd-quiz-q', className)}>
      <div className="dd-quiz-q__meta">
        <span>
          Question {index + 1}
          {total ? ` of ${total}` : ''}
        </span>
        <span aria-hidden>·</span>
        <span>{question.conceptName}</span>
        {question.carriedFrom ? <Tag color="orange">Carried over</Tag> : null}
      </div>
      <div className="dd-quiz-q__stem" id={`q-${question.id}`}>
        {question.stem}
      </div>
      <RadioGroup label={question.stem}>
        {question.options.map((option, i) => (
          <RadioRow
            // biome-ignore lint/suspicious/noArrayIndexKey: options are positional (A–D)
            key={i}
            checked={chosenIndex === i}
            tone={toneFor(i)}
            hint={hintFor(i)}
            disabled={disabled || revealed}
            keyHint={showKeys && !revealed ? String(i + 1) : undefined}
            onSelect={() => onAnswer?.(i)}
          >
            {option}
          </RadioRow>
        ))}
      </RadioGroup>
      {result ? (
        <div
          className={cx(
            'dd-quiz-q__feedback',
            result.correct ? 'dd-quiz-q__feedback--correct' : 'dd-quiz-q__feedback--wrong',
          )}
          role="status"
        >
          {result.correct ? <CircleCheck size={16} aria-hidden /> : <CircleX size={16} aria-hidden />}
          <span>
            <strong>{result.correct ? 'Correct.' : 'Not quite.'}</strong>{' '}
            {result.correct
              ? 'Nice — that idea is sticking.'
              : `The answer is ${correctLetter}. This one comes back in your next review.`}
          </span>
        </div>
      ) : null}
    </div>
  )
}
