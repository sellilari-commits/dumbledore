/**
 * Exams view: this subject's exams, reviews and checkpoints as a Notion table (name, type,
 * questions, score, date). A row opens the exam; "New exam" opens the shared New exam dialog
 * with this subject preselected.
 */
import { Button, type Column, DatabaseTable, EmptyState, Tag } from '@renderer/design-system'
import { formatRelative } from '@renderer/lib/format'
import { useShell } from '@renderer/lib/shell'
import { QUIZ_KIND, scoreColor } from '@renderer/lib/status'
import type { QuizKind } from '@shared/domain'
import type { QuizSummary } from '@shared/state'
import { ALargeSmall, Calendar, CircleChevronDown, Hash, Plus, Target } from 'lucide-react'
import { useLocation } from 'wouter'

const HEAD = { size: 14, strokeWidth: 1.75 } as const

const KIND_ICON: Record<QuizKind, string> = {
  exam: '📝',
  review: '🔁',
  checkpoint: '🎯',
  placement: '🧭',
}

/** "Weak-spots exam · Organic Chemistry" → "Weak-spots exam" (the page already names it). */
function shortTitle(title: string, subjectName: string): string {
  const suffix = ` · ${subjectName}`
  return title.endsWith(suffix) ? title.slice(0, -suffix.length) : title
}

function scoreText(q: QuizSummary): string {
  if (q.score === null) return ''
  return `${Math.round(q.score * q.questionCount)}/${q.questionCount} · ${Math.round(q.score * 100)}%`
}

function columns(subjectName: string): Column<QuizSummary>[] {
  return [
    {
      key: 'name',
      header: 'Name',
      icon: <ALargeSmall {...HEAD} />,
      render: (q) => (
        <span className="dd-table__title-cell" title={q.title}>
          <span aria-hidden>{KIND_ICON[q.kind]}</span>
          <span>{shortTitle(q.title, subjectName)}</span>
        </span>
      ),
    },
    {
      key: 'type',
      header: 'Type',
      icon: <CircleChevronDown {...HEAD} />,
      width: 112,
      render: (q) => <Tag color={QUIZ_KIND[q.kind].color}>{QUIZ_KIND[q.kind].label}</Tag>,
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
      width: 120,
      render: (q) =>
        q.score === null ? (
          <Tag color="gray">{q.completedAt ? 'No score' : 'Not taken'}</Tag>
        ) : (
          <Tag color={scoreColor(q.score)}>{scoreText(q)}</Tag>
        ),
    },
    {
      key: 'date',
      header: 'Date',
      icon: <Calendar {...HEAD} />,
      width: 112,
      render: (q) => (
        <span className="dd-table__muted">{formatRelative(q.completedAt ?? q.createdAt)}</span>
      ),
    },
  ]
}

/** "New exam" for this subject: quiet (ghost) in the view-tab bar, primary in the empty state. */
export function NewExamButton({
  subjectId,
  size = 'sm',
}: {
  subjectId: string
  size?: 'sm' | 'md'
}) {
  const openNewExam = useShell((s) => s.openNewExam)
  return (
    <Button
      variant={size === 'sm' ? 'ghost' : 'primary'}
      size={size}
      icon={<Plus size={size === 'sm' ? 14 : 16} />}
      onClick={() => openNewExam([subjectId])}
    >
      New exam
    </Button>
  )
}

export function ExamsView({
  exams,
  subjectId,
  subjectName,
  canCreate,
}: {
  exams: QuizSummary[]
  subjectId: string
  subjectName: string
  /** Only active subjects can get new exams (the New exam dialog lists active subjects). */
  canCreate: boolean
}) {
  const [, navigate] = useLocation()
  if (exams.length === 0)
    return (
      <EmptyState
        icon="📝"
        title="No exams for this subject yet"
        actions={canCreate ? <NewExamButton subjectId={subjectId} size="md" /> : null}
      >
        {canCreate
          ? 'Dumbledore writes questions from what you studied here, then shows exactly where your gaps are.'
          : `Add ${subjectName} to your subjects first — then Dumbledore can write exams from it.`}
      </EmptyState>
    )
  const rows = [...exams].sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  return (
    <DatabaseTable
      label={`${subjectName} exams`}
      columns={columns(subjectName)}
      rows={rows}
      rowKey={(q) => q.id}
      onRowClick={(q) => navigate(`/exams/${q.id}`)}
    />
  )
}
