/**
 * The subject's Notion property rows: Deadline (date popover), Goal (inline text), Status
 * (learning status + due / struggling tags), Progress (roadmap bar), This week (study time) and
 * the next open assignment. Edits go through `onPatch` (subjects.update).
 */
import {
  Button,
  Input,
  Popover,
  ProgressBar,
  Property,
  PropertyList,
  Tag,
} from '@renderer/design-system'
import { formatCount, formatDate, formatDue, formatMinutes } from '@renderer/lib/format'
import { DUE, MASTERY } from '@renderer/lib/status'
import type { SubjectDetail, SubjectPatch } from '@shared/state'
import { Calendar, CircleDot, Flag, ListChecks, NotebookPen, Timer } from 'lucide-react'
import { useState } from 'react'
import { EditableText } from './EditableText'
import { roadmapProgress, subjectStatus } from './subject-utils'

const ICON = { size: 16, strokeWidth: 1.75 } as const

/** ISO → the yyyy-mm-dd a date input wants, in local time. */
function toDateInput(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** yyyy-mm-dd → ISO at local noon (no time-zone day shifts), or null when empty/invalid. */
function fromDateInput(value: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null
  const d = new Date(`${value}T12:00:00`)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

function DeadlineValue({
  value,
  onSave,
}: {
  value: string | null
  onSave: (iso: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState(toDateInput(value))
  const close = (save: boolean) => {
    setOpen(false)
    const next = fromDateInput(draft)
    if (save && toDateInput(next) !== toDateInput(value)) onSave(next)
  }
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        if (o) {
          setDraft(toDateInput(value))
          setOpen(true)
        } else close(true)
      }}
      label="Deadline"
      className="sp-date-pop"
      trigger={
        <button
          type="button"
          className={value ? 'sp-edit' : 'sp-edit sp-edit--empty'}
          title={value ? formatDate(value) : undefined}
        >
          {value ? formatDue(value) : 'Add a deadline'}
        </button>
      }
    >
      <Input
        type="date"
        aria-label="Deadline date"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') close(true)
        }}
      />
      <div className="sp-date-pop__actions">
        <Button
          size="sm"
          variant="ghost"
          onClick={() => {
            setDraft('')
            setOpen(false)
            if (value) onSave(null)
          }}
        >
          Clear
        </Button>
        <Button size="sm" variant="primary" onClick={() => close(true)}>
          Done
        </Button>
      </div>
    </Popover>
  )
}

export function SubjectProperties({
  detail,
  onPatch,
}: {
  detail: SubjectDetail
  onPatch: (patch: SubjectPatch) => void
}) {
  const { subject, roadmap, concepts, assignments } = detail
  const status = subjectStatus(subject, concepts)
  const struggling = concepts.filter((c) => c.status === 'struggling').length
  const progress = roadmap ? roadmapProgress(roadmap) : null
  const nextAssignment = assignments
    .filter((a) => a.status === 'open' && a.dueAt)
    .sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''))[0]

  return (
    <PropertyList>
      <Property icon={<Calendar {...ICON} />} label="Deadline">
        <DeadlineValue value={subject.deadline} onSave={(deadline) => onPatch({ deadline })} />
      </Property>
      <Property icon={<Flag {...ICON} />} label="Goal">
        <EditableText
          value={subject.goal ?? ''}
          label="Goal"
          placeholder="Add a goal"
          allowEmpty
          onSave={(goal) => onPatch({ goal: goal || null })}
        />
      </Property>
      <Property icon={<CircleDot {...ICON} />} label="Status">
        <span className="sp-tags">
          <Tag color={status.color} dot>
            {status.label}
          </Tag>
          {subject.dueReviews > 0 ? (
            <Tag color={DUE.color}>{formatCount(subject.dueReviews, 'review')} due</Tag>
          ) : null}
          {struggling > 0 ? (
            <Tag color={MASTERY.struggling.color}>{struggling} struggling</Tag>
          ) : null}
        </span>
      </Property>
      <Property icon={<ListChecks {...ICON} />} label="Progress" empty="No roadmap yet">
        {progress ? (
          <span className="sp-progress">
            <ProgressBar value={subject.progress} showValue width={180} label="Roadmap progress" />
            <span className="sp-muted">
              {progress.done} of {progress.total} steps
            </span>
          </span>
        ) : null}
      </Property>
      <Property icon={<Timer {...ICON} />} label="This week" empty="Nothing yet">
        {subject.studyMinutesWeek > 0 ? formatMinutes(subject.studyMinutesWeek) : null}
      </Property>
      {nextAssignment ? (
        <Property icon={<NotebookPen {...ICON} />} label="Next due">
          <span className="sp-assignment">
            <span className="sp-assignment__title">{nextAssignment.title}</span>
            <span className="sp-muted">· {formatDue(nextAssignment.dueAt)}</span>
          </span>
        </Property>
      ) : null}
    </PropertyList>
  )
}
