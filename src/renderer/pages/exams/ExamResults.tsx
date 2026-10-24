/**
 * Exam results: the score, a by-concept table, "Your gaps" (ExamGaps: repair prompt for the
 * student's AI), what comes next, and a toggle to review every answer — the gap rows' Q links
 * open it at that question. Results come from 'quiz.finish' (idempotent for finished quizzes).
 */
import {
  Callout,
  type Column,
  DatabaseTable,
  ErrorState,
  LoadingState,
  PageHeader,
  ProgressBar,
  QuizQuestion,
  Section,
  Tag,
  ToggleBlock,
} from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { formatRelative } from '@renderer/lib/format'
import { useAppState } from '@renderer/lib/queries'
import { MASTERY, scoreColor } from '@renderer/lib/status'
import type { Quiz, QuizResult } from '@shared/domain'
import { useQuery } from '@tanstack/react-query'
import { ArrowRight, CalendarClock, CircleCheck } from 'lucide-react'
import { useState } from 'react'
import { ExamGaps } from './ExamGaps'
import { barColor, gapRows, metaLine } from './exam-utils'
import { KindIcon } from './KindIcon'
import './exam-page.css'

type ConceptRow = QuizResult['byConcept'][number]

const CONCEPT_COLUMNS: Column<ConceptRow>[] = [
  {
    key: 'concept',
    header: 'Concept',
    render: (r) => <span className="dd-table__title-cell">{r.conceptName}</span>,
  },
  {
    key: 'score',
    header: 'Score',
    width: 190,
    render: (r) => (
      <span className="ex-concept-score">
        <ProgressBar
          value={r.total ? r.correct / r.total : 0}
          color={barColor(r.total ? r.correct / r.total : null)}
          label={`${r.conceptName}: ${r.correct} of ${r.total}`}
          width={96}
        />
        <span className="ex-concept-score__n">
          {r.correct}/{r.total}
        </span>
      </span>
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: 130,
    render: (r) => <Tag color={MASTERY[r.status].color}>{MASTERY[r.status].label}</Tag>,
  },
]

function scoreLine(r: QuizResult): string {
  const left = r.total - r.correct
  if (left <= 0) return 'Every answer right.'
  return r.fixPrompt
    ? `${left} to work on — Dumbledore turned them into one prompt below.`
    : `${left} to work on — they come back in your next review.`
}

export interface ExamResultsProps {
  quiz: Quiz
  subjectLine: string
}

export function ExamResults({ quiz, subjectLine }: ExamResultsProps) {
  const results = useQuery({
    queryKey: ['quiz.finish', quiz.id],
    queryFn: () => invoke('quiz.finish', quiz.id),
    staleTime: Number.POSITIVE_INFINITY,
  })
  const app = useAppState()
  const [reviewOpen, setReviewOpen] = useState(false)
  const assistant = app.data?.assistant?.name ?? app.data?.aiChat?.provider ?? 'your AI'
  const when = formatRelative(quiz.completedAt)
  const finished = quiz.completedAt
    ? `Finished ${when === 'Yesterday' ? 'yesterday' : when}`
    : 'Finished'
  const header = (
    <PageHeader
      icon={<KindIcon kind={quiz.kind} size={44} />}
      title={quiz.title}
      subtitle={metaLine([finished, subjectLine])}
    />
  )

  const showQuestion = (n: number) => {
    setReviewOpen(true)
    const q = quiz.questions[n - 1]
    if (q)
      requestAnimationFrame(() =>
        document
          .getElementById(`exam-review-q-${q.id}`)
          ?.scrollIntoView?.({ block: 'start', behavior: 'smooth' }),
      )
  }

  if (results.isLoading)
    return (
      <>
        {header}
        <LoadingState caption="Scoring your answers…" lines={5} className="ex-generating" />
      </>
    )
  if (results.isError || !results.data)
    return (
      <>
        {header}
        <ErrorState
          title="Couldn’t score this exam"
          error={results.error}
          onRetry={() => void results.refetch()}
        />
      </>
    )

  const r = results.data
  const perfect = r.total > 0 && r.correct === r.total
  return (
    <>
      {header}
      <div className="ex-score">
        <span className="ex-score__big">{`${r.correct} / ${r.total}`}</span>
        <Tag color={scoreColor(r.score)} className="ex-score__tag">
          {`${Math.round(r.score * 100)}%`}
        </Tag>
        <span className="ex-score__sub">{scoreLine(r)}</span>
      </div>

      <Section title="By concept">
        <DatabaseTable
          label="Score by concept"
          columns={CONCEPT_COLUMNS}
          rows={r.byConcept}
          rowKey={(row) => row.conceptName}
          footer={false}
        />
      </Section>

      <div className="ex-fix">
        {perfect || r.gaps.length === 0 ? (
          <Callout
            icon={<CircleCheck size={18} strokeWidth={1.75} />}
            color="green"
            title="No gaps this time"
          >
            Dumbledore will space out the next review of these concepts.
          </Callout>
        ) : (
          <ExamGaps
            rows={gapRows(r.gaps, quiz)}
            prompt={r.fixPrompt}
            assistant={assistant}
            onShowQuestion={showQuestion}
          />
        )}
        <div className="ex-next">
          {r.nextTopic ? (
            <div className="ex-next__line">
              <ArrowRight size={16} aria-hidden />
              <span>
                Next up: <strong>{r.nextTopic}</strong>
              </span>
            </div>
          ) : null}
          {!perfect ? (
            <div className="ex-next__line">
              <CalendarClock size={16} aria-hidden />
              <span>Dumbledore will re-test your gaps in 2 days.</span>
            </div>
          ) : null}
        </div>
      </div>

      <div className="ex-review">
        <ToggleBlock title="Review your answers" open={reviewOpen} onOpenChange={setReviewOpen}>
          <div className="ex-review__list">
            {quiz.questions.map((q, i) => {
              const a = quiz.answers.find((x) => x.questionId === q.id)
              return (
                <div key={q.id} id={`exam-review-q-${q.id}`} className="ex-review__item">
                  <QuizQuestion
                    index={i}
                    total={quiz.questions.length}
                    question={q}
                    chosenIndex={a?.chosenIndex ?? null}
                    result={{ correct: a?.correct ?? false, correctIndex: q.correctIndex }}
                    disabled
                  />
                </div>
              )
            })}
          </div>
        </ToggleBlock>
      </div>
    </>
  )
}
