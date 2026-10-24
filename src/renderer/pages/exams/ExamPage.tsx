/**
 * Exam page (/exams/:id): loads the quiz and shows the state it is in — being written
 * (specific skeleton copy), failed, ready to take / in progress (ExamTaking) or done
 * (ExamResults).
 */
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Skeleton,
} from '@renderer/design-system'
import { useQuiz, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { Quiz } from '@shared/domain'
import type { ReactNode } from 'react'
import { useLocation, useParams } from 'wouter'
import { PageFrame } from '../PageFrame'
import { ExamResults } from './ExamResults'
import { ExamTaking } from './ExamTaking'
import { KIND_ICON, subjectLine, subjectNames, subjectsFor } from './exam-utils'
import './exam-page.css'

function QuestionSkeleton() {
  return (
    <div className="ex-q-skeleton" aria-hidden>
      <Skeleton width={180} height={12} />
      <Skeleton width="76%" height={18} />
      {[0, 1, 2, 3].map((i) => (
        <Skeleton key={i} height={38} radius={6} />
      ))}
    </div>
  )
}

function Generating({ quiz, names }: { quiz: Quiz; names: string }) {
  const n = quiz.questions.length
  return (
    <>
      <PageHeader icon={KIND_ICON[quiz.kind]} title={quiz.title} />
      <LoadingState
        className="ex-generating"
        caption={n > 0 ? `Writing ${n} questions on ${names}…` : `Writing your exam on ${names}…`}
      >
        <QuestionSkeleton />
        <QuestionSkeleton />
      </LoadingState>
    </>
  )
}

export function ExamPage() {
  const { id } = useParams<{ id: string }>()
  const quiz = useQuiz(id)
  const subjects = useSubjects()
  const openNewExam = useShell((s) => s.openNewExam)
  const [, navigate] = useLocation()

  const data = quiz.data
  const list = data ? subjectsFor(data.subjectIds, subjects.data) : []
  const crumbs = [{ label: 'Exams', href: '/exams' }, { label: data?.title ?? 'Exam' }]
  const again = data ? (
    <Button size="sm" variant="ghost" onClick={() => openNewExam(data.subjectIds)}>
      New exam
    </Button>
  ) : null

  let body: ReactNode
  if (quiz.isLoading) body = <LoadingState className="ex-generating" caption="Opening your exam…" />
  else if (quiz.isError || !data)
    body = (
      <ErrorState
        title="Couldn’t open this exam"
        error={quiz.error}
        onRetry={() => void quiz.refetch()}
      />
    )
  else if (data.status === 'generating')
    body = <Generating quiz={data} names={subjectNames(list)} />
  else if (data.status === 'failed')
    body = (
      <EmptyState
        icon="⚠️"
        title="Dumbledore couldn’t write this exam"
        actions={
          <>
            <Button variant="primary" onClick={() => openNewExam(data.subjectIds)}>
              Try a new exam
            </Button>
            <Button variant="ghost" onClick={() => navigate('/exams')}>
              Back to exams
            </Button>
          </>
        }
      >
        The free AI services may be busy. Your progress is safe — try again in a minute.
      </EmptyState>
    )
  else if (data.status === 'done')
    body = <ExamResults quiz={data} subjectLine={subjectLine(list)} />
  else body = <ExamTaking quiz={data} subjectLine={subjectLine(list)} />

  return (
    <PageFrame crumbs={crumbs} actions={data?.status === 'done' ? again : undefined}>
      {body}
    </PageFrame>
  )
}
