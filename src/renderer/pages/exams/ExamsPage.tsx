/**
 * Exams list (/exams): every exam and review as a Notion table — name, type, subjects, score
 * and date — with "New exam" (⌘E) and loading / empty / error states. The empty state carries
 * the only "New exam" button (one primary action per surface).
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
import {
  ALargeSmall,
  Calendar,
  CircleChevronDown,
  FilePen,
  Layers,
  Plus,
  Target,
} from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { PageFrame } from '../PageFrame'
import { scoreText, shortTitle, subjectsFor } from './exam-utils'
import { KindIcon } from './KindIcon'
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
            <KindIcon kind={q.kind} />
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
      width: 100,
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
      key: 'score',
      header: 'Score',
      icon: <Target {...HEAD} />,
      width: 112,
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
      width: 96,
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
            <Skeleton width={72} height={18} />
            <Skeleton width={64} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}

/** No exams yet: "New exam", or "New subject" first when there is nothing to write one from. */
function EmptyExams({ hasSubjects }: { hasSubjects: boolean }) {
  const openNewExam = useShell((s) => s.openNewExam)
  const setNewSubject = useShell((s) => s.setNewSubject)
  if (!hasSubjects)
    return (
      <EmptyState
        title="No exams yet"
        actions={
          <Button
            variant="primary"
            icon={<Plus size={16} />}
            shortcut="⌘N"
            onClick={() => setNewSubject(true)}
          >
            New subject
          </Button>
        }
      >
        Exams are written from your subjects. Add one — or keep studying and Dumbledore will suggest
        some.
      </EmptyState>
    )
  return (
    <EmptyState
      title="No exams yet"
      actions={
        <Button
          variant="primary"
          icon={<Plus size={16} />}
          shortcut="⌘E"
          onClick={() => openNewExam()}
        >
          New exam
        </Button>
      }
    >
      Pick a subject and Dumbledore writes questions from what you studied — then shows exactly
      where your gaps are.
    </EmptyState>
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

  const empty = exams.isSuccess && exams.data.length === 0
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
  else if (empty)
    body = <EmptyExams hasSubjects={subjects.data?.some((x) => x.status === 'active') ?? true} />
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
    <PageFrame crumbs={[{ label: 'Exams' }]} actions={empty ? null : newExam} width="wide">
      <PageHeader
        icon={<FilePen size={44} strokeWidth={1.5} />}
        title="Exams"
        subtitle="Checks Dumbledore wrote from what you studied. Misses come back in later reviews."
      />
      <div className="ex-list">{body}</div>
    </PageFrame>
  )
}
