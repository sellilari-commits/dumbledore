/**
 * One inbox item: where it came from (app, title, host, time), the three parts — what was seen,
 * the big picture, and whether it was understood (coloured tag + evidence) — and the triage
 * actions: file under a subject, keep, ignore (or restore).
 */
import { Button, Tag } from '@renderer/design-system'
import { formatRelative } from '@renderer/lib/format'
import { UNDERSTANDING } from '@renderer/lib/status'
import type { Encounter, SubjectSummary } from '@shared/domain'
import {
  Check,
  CirclePlay,
  FileText,
  Globe,
  type LucideIcon,
  MessageCircle,
  NotebookPen,
  RotateCcw,
  X,
} from 'lucide-react'
import type { ReactNode } from 'react'
import {
  type InboxAction,
  type SourceKind,
  sourceKind,
  sourceMeta,
  sourceTitle,
} from './inbox-utils'
import { SubjectMenu } from './SubjectMenu'

const SOURCE_ICON: Record<SourceKind, LucideIcon> = {
  ai: MessageCircle,
  video: CirclePlay,
  document: FileText,
  notes: NotebookPen,
  web: Globe,
}

export interface EncounterRowProps {
  encounter: Encounter
  subjects: SubjectSummary[]
  busy: boolean
  onAct: (action: InboxAction, subjectId: string | null) => void
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <li className="ib-part">
      <div className="ib-part__label">{label}</div>
      <div className="ib-part__value">{children}</div>
    </li>
  )
}

export function EncounterRow({ encounter: e, subjects, busy, onAct }: EncounterRowProps) {
  const Icon = SOURCE_ICON[sourceKind(e.source)]
  const subject = subjects.find((s) => s.id === e.subjectId)
  const understanding = UNDERSTANDING[e.understanding]
  const title = sourceTitle(e)
  return (
    <article className="ib-item" aria-label={title} data-state={e.inboxState}>
      <header className="ib-item__head">
        <span className="ib-item__icon" aria-hidden>
          <Icon size={16} strokeWidth={1.75} />
        </span>
        <div className="ib-item__source">
          <h3 className="ib-item__title" title={e.source.url ?? undefined}>
            {title}
          </h3>
          <div className="ib-item__meta">{sourceMeta(e)}</div>
        </div>
        <time className="ib-item__time" dateTime={e.createdAt}>
          {formatRelative(e.createdAt)}
        </time>
      </header>

      <ul className="ib-parts" aria-label="What Dumbledore extracted">
        <Part label="Seen">
          <blockquote className="ib-seen">{e.seen}</blockquote>
        </Part>
        <Part label="Big picture">
          <span>{e.bigPicture}</span>
          {e.topicPath.length > 0 ? (
            <span className="ib-path">{e.topicPath.join(' › ')}</span>
          ) : null}
        </Part>
        <Part label="Understanding">
          <span className="ib-understanding">
            <Tag color={understanding.color} dot>
              {understanding.label}
            </Tag>
            {e.evidence ? <span className="ib-evidence">{e.evidence}</span> : null}
          </span>
        </Part>
      </ul>

      <footer className="ib-item__actions">
        <SubjectMenu
          label={`File “${title}” under a subject`}
          subjects={subjects}
          value={e.subjectId}
          heading="File under"
          disabled={busy}
          onPick={(id) => onAct('assign', id)}
          className={subject ? undefined : 'ib-select--empty'}
        >
          {subject ? `${subject.emoji} ${subject.name}` : 'Choose a subject'}
        </SubjectMenu>
        <div className="ib-item__buttons">
          {e.inboxState === 'ignored' ? (
            <Button
              size="sm"
              icon={<RotateCcw size={14} />}
              disabled={busy}
              onClick={() => onAct('accept', null)}
            >
              Restore
            </Button>
          ) : (
            <>
              {e.inboxState === 'new' ? (
                <Button
                  size="sm"
                  icon={<Check size={14} />}
                  disabled={busy}
                  onClick={() => onAct('accept', null)}
                >
                  Keep
                </Button>
              ) : (
                <span className="ib-item__state">Kept</span>
              )}
              <Button
                size="sm"
                variant="ghost"
                icon={<X size={14} />}
                disabled={busy}
                onClick={() => onAct('ignore', null)}
              >
                Ignore
              </Button>
            </>
          )}
        </div>
      </footer>
    </article>
  )
}
