/**
 * Exams list (/exams): every exam and review as a Notion table — name, type, subjects,
 * questions, score and date — with "New exam" (⌘E) and loading / empty / error states.
 */
import {
  Button,
  type Column,
  DatabaseTable,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Skeleton,
  Tag,
} from '@renderer/design-system'
import { formatRelative } from '@renderer/lib/format'
import { useExams, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import { QUIZ_KIND, scoreColor } from '@renderer/lib/status'
import type { SubjectSummary } from '@shared/domain'
import type { QuizSummary } from '@shared/state'
import { ALargeSmall, Calendar, CircleChevronDown, Hash, Layers, Plus, Target } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { PageFrame } from '../PageFrame'
import { KIND_ICON, scoreText, shortTitle, subjectsFor } from './exam-utils'
import './exams.css'

const HEAD = { size: 14, strokeWidth: 1.75 } as const

function SubjectsCell({
  ids,
  subjects,
}: {
  ids: string[]
  subjects: SubjectSummary[] | undefined
}) {
  const list = subjectsFor(ids, subjects)
  if (list.length === 0) return <span className="dd-table__muted">—</span>
  const names = list.map((s) => s.name).join(', ')
  return (
    <span className="ex-subjects-cell" title={names}>
      <span aria-hidden>{list.map((s) => s.emoji).join(' ')}</span>
      <span>{list.length === 1 ? list[0]?.name : `${list.length} subjects`}</span>
    </span>
  )
}

function columns(subjects: SubjectSummary[] | undefined): Column<QuizSummary>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      icon: <ALargeSmall {...HEAD} />,
      render: (q) => (
        <span className="ex-title-cell" title={q.title}>
          <span className="ex-title-cell__icon" aria-hidden>
            {KIND_ICON[q.kind]}
          </span>
          <span className="ex-title-cell__text">
            {shortTitle(q.title, subjectsFor(q.subjectIds, subjects))}
          </span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      icon: <CircleChevronDown {...HEAD} />,
      width: 88,
      render: (q) => <Tag color={QUIZ_KIND[q.kind].color}>{QUIZ_KIND[q.kind].label}</Tag>,
    },
    {
      key: 'subjects',
      header: 'Subjects',
      icon: <Layers {...HEAD} />,
      width: 164,
      render: (q) => <SubjectsCell ids={q.subjectIds} subjects={subjects} />,
    },
    {
      key: 'questions',
      header: 'Questions',
      icon: <Hash {...HEAD} />,
      width: 108,
      align: 'right',
      render: (q) => <span className="dd-table__num">{q.questionCount}</span>,
    },
    {
      key: 'score',
      header: 'Score',
      icon: <Target {...HEAD} />,
      width: 104,
      render: (q) =>
        q.score === null ? (
          <Tag color="gray">Not taken</Tag>
        ) : (
          <Tag color={scoreColor(q.score)}>{scoreText(q.score, q.questionCount)}</Tag>
        ),
    },
    {
      key: 'date',
      header: 'Date',
      icon: <Calendar {...HEAD} />,
      width: 100,
      render: (q) => (
        <span className="dd-table__muted">{formatRelative(q.completedAt ?? q.createdAt)}</span>
      ),
    },
  ]
}

function ListSkeleton() {
  return (
    <LoadingState caption="Loading your exams…">
      <div aria-hidden>
        {[0.62, 0.48, 0.55, 0.4].map((w) => (
          <div key={w} className="ex-skeleton-row">
            <Skeleton width={`${w * 100}%`} />
            <Skeleton width={56} height={18} />
            <Skeleton width="70%" />
            <Skeleton width={20} />
            <Skeleton width={72} height={18} />
            <Skeleton width={64} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}

export function ExamsPage() {
  const exams = useExams()
  const subjects = useSubjects()
  const openNewExam = useShell((s) => s.openNewExam)
  const [, navigate] = useLocation()

  const newExam = (
    <Button variant="primary" size="sm" shortcut="⌘E" onClick={() => openNewExam()}>
      New exam
    </Button>
  )

  let body: ReactNode
  if (exams.isLoading) body = <ListSkeleton />
  else if (exams.isError)
    body = (
      <ErrorState
        title="Couldn’t load your exams"
        error={exams.error}
        onRetry={() => void exams.refetch()}
      />
    )
  else if ((exams.data ?? []).length === 0)
    body = (
      <EmptyState
        icon="📝"
        title="No exams yet"
        actions={
          <Button variant="primary" icon={<Plus size={16} />} onClick={() => openNewExam()}>
            New exam
          </Button>
        }
      >
        Pick a subject and Dumbledore writes questions from what you studied — then shows exactly
        where your gaps are.
      </EmptyState>
    )
  else
    body = (
      <DatabaseTable
        label="Exams"
        columns={columns(subjects.data)}
        rows={exams.data ?? []}
        rowKey={(q) => q.id}
        onRowClick={(q) => navigate(`/exams/${q.id}`)}
      />
    )

  return (
    <PageFrame crumbs={[{ label: 'Exams' }]} actions={newExam} width="wide">
      <PageHeader
        icon="📝"
        title="Exams"
        subtitle="Checks Dumbledore wrote from what you studied. Misses come back in later reviews."
      />
      <div className="ex-list">{body}</div>
    </PageFrame>
  )
}
