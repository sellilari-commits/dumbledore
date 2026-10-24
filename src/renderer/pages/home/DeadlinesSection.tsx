/**
 * Home → Upcoming deadlines: assignments and subject deadlines, soonest first. The due date is
 * grey unless it means something (orange within two days, red when overdue). "Add deadline"
 * opens an inline row (assignments.add).
 */
import { Button, Section, Tag } from '@renderer/design-system'
import { formatDue } from '@renderer/lib/format'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { CalendarClock, CalendarDays, Plus } from 'lucide-react'
import { useState } from 'react'
import { AddDeadline } from './AddDeadline'
import { dueColor } from './home-utils'
import { RouteLink } from './RouteLink'

type Item = HomeData['deadlines'][number]

function DueLabel({ iso }: { iso: string }) {
  const color = dueColor(iso)
  const text = formatDue(iso)
  return color ? <Tag color={color}>{text}</Tag> : <span className="hm-row__meta">{text}</span>
}

function DeadlineRow({ item }: { item: Item }) {
  const body = (
    <>
      <span className="hm-row__emoji" aria-hidden>
        {item.subjectEmoji ?? <CalendarDays size={16} strokeWidth={1.75} />}
      </span>
      <span className="hm-row__title">{item.title}</span>
      <DueLabel iso={item.dueAt} />
    </>
  )
  return (
    <li>
      {item.subjectId ? (
        <RouteLink to={APP_ROUTES.subject(item.subjectId)} className="hm-row">
          {body}
        </RouteLink>
      ) : (
        <div className="hm-row hm-row--static">{body}</div>
      )}
    </li>
  )
}

export function DeadlinesSection({ items }: { items: HomeData['deadlines'] }) {
  const [adding, setAdding] = useState(false)
  return (
    <Section
      id="home-deadlines"
      title="Upcoming deadlines"
      icon={<CalendarClock size={14} strokeWidth={1.75} />}
      actions={
        adding ? null : (
          <Button
            size="xs"
            variant="ghost"
            icon={<Plus size={14} strokeWidth={1.75} />}
            onClick={() => setAdding(true)}
          >
            Add deadline
          </Button>
        )
      }
    >
      {items.length === 0 && !adding ? (
        <p className="hm-quiet">
          No deadlines yet. Dumbledore picks them up from course pages, or add one yourself.
        </p>
      ) : (
        <ul className="hm-list">
          {items.map((d) => (
            <DeadlineRow key={`${d.kind}-${d.id}`} item={d} />
          ))}
        </ul>
      )}
      {adding ? <AddDeadline onClose={() => setAdding(false)} /> : null}
    </Section>
  )
}
