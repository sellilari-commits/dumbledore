/**
 * Seen view: what Dumbledore saw for this subject, grouped by day. Each encounter shows its
 * source (app, page, time, dwell) and the three parts from the brief — Seen, Big picture and
 * Understanding (with the evidence) — plus open questions when there are any.
 */
import { EmptyState, Tag } from '@renderer/design-system'
import { formatSeconds, formatTime, hostOf } from '@renderer/lib/format'
import { UNDERSTANDING } from '@renderer/lib/status'
import type { Encounter } from '@shared/domain'
import { Eye, FileText, Globe, MessageSquare, Monitor, Play } from 'lucide-react'
import type { ReactNode } from 'react'
import { groupByDay } from './subject-utils'

function sourceIcon(e: Encounter): ReactNode {
  const app = e.source.app.toLowerCase()
  const Icon = e.source.url
    ? Globe
    : app.includes('chatgpt') || app.includes('claude')
      ? MessageSquare
      : app.includes('youtube') || app.includes('video')
        ? Play
        : app.includes('preview') || app.includes('pdf')
          ? FileText
          : Monitor
  return <Icon size={16} strokeWidth={1.75} />
}

function Part({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="sp-part">
      <div className="sp-part__label">{label}</div>
      <div className="sp-part__value">{children}</div>
    </div>
  )
}

function EncounterBlock({ e }: { e: Encounter }) {
  const host = hostOf(e.source.url)
  const u = UNDERSTANDING[e.understanding]
  const title = e.source.title ?? e.source.app
  return (
    <article className="sp-enc" aria-label={title}>
      <header className="sp-enc__head">
        <span className="sp-enc__icon" aria-hidden>
          {sourceIcon(e)}
        </span>
        <span className="sp-enc__title">{title}</span>
        {e.inboxState === 'new' ? <Tag color="blue">New</Tag> : null}
        <span className="sp-enc__meta">
          {[host ?? e.source.app, formatTime(e.createdAt), formatSeconds(e.dwellSeconds)].join(
            ' · ',
          )}
        </span>
      </header>
      <div className="sp-enc__body">
        <Part label="Seen">
          <blockquote className="sp-quote">{e.seen}</blockquote>
        </Part>
        <Part label="Big picture">
          <span>{e.bigPicture}</span>
          {e.topicPath.length > 0 ? (
            <span className="sp-path">{e.topicPath.join(' › ')}</span>
          ) : null}
        </Part>
        <Part label="Understanding">
          <span className="sp-understanding">
            <Tag color={u.color} dot>
              {u.label}
            </Tag>
            {e.evidence ? <span className="sp-muted">{e.evidence}</span> : null}
          </span>
        </Part>
        {e.openQuestions.length > 0 ? (
          <Part label="Open questions">
            <ul className="sp-questions">
              {e.openQuestions.map((q) => (
                <li key={q}>{q}</li>
              ))}
            </ul>
          </Part>
        ) : null}
      </div>
    </article>
  )
}

export function SeenView({ encounters }: { encounters: Encounter[] }) {
  if (encounters.length === 0)
    return (
      <EmptyState icon={<Eye size={28} strokeWidth={1.5} />} title="Nothing seen yet">
        When you read, watch or ask an AI about this subject, Dumbledore notes what you saw, why it
        mattered and whether it clicked — right here.
      </EmptyState>
    )
  return (
    <div className="sp-seen">
      {groupByDay(encounters).map((g) => (
        <section key={g.key} className="sp-day" aria-label={g.label}>
          <h3 className="sp-day__label">{g.label}</h3>
          {g.items.map((e) => (
            <EncounterBlock key={e.id} e={e} />
          ))}
        </section>
      ))}
    </div>
  )
}
