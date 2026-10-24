/**
 * Memory · Recent: a quiet timeline by day. Each entry is a page (its title links to it) with
 * what was saved from it and where it went ("→ 3 notes in Machine Learning › Artificial neurons").
 * The notes fold open under the entry, with the same edit and delete as By topic.
 */
import { ChevronRight } from 'lucide-react'
import { useState } from 'react'
import { NoteItem } from './MemoryNotes'
import { notesCount, type RecentDay, type RecentEntry, shortAgo } from './memory-model'

function EntryRow({ entry, forceOpen }: { entry: RecentEntry; forceOpen: boolean }) {
  const [open, setOpen] = useState(false)
  const expanded = open || forceOpen
  return (
    <li className="mem-entry" data-testid="mem-entry">
      <div className="mem-entry__row">
        <button
          type="button"
          className="mem-topic__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Fold' : 'Open'} notes from ${entry.source.label}`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight size={14} strokeWidth={1.75} className="mem-topic__chev" />
        </button>
        <span className="mem-entry__main">
          {entry.source.href ? (
            <a
              className="mem-entry__title mem-source__link"
              href={entry.source.href}
              target="_blank"
              rel="noreferrer noopener"
              title={entry.source.href}
            >
              {entry.source.label}
            </a>
          ) : (
            <span className="mem-entry__title">{entry.source.label}</span>
          )}
          <span className="mem-entry__where">
            → {notesCount(entry.notes.length)} in {entry.places.join(', ')}
          </span>
        </span>
        <span className="mem-entry__time">{shortAgo(entry.at)}</span>
      </div>
      {expanded && (
        <ul className="mem-notes mem-entry__notes">
          {entry.notes.map((n) => (
            <NoteItem key={n.id} note={n} showSource={false} />
          ))}
        </ul>
      )}
    </li>
  )
}

export function RecentView({ days, searching }: { days: RecentDay[]; searching: boolean }) {
  return (
    <div className="mem-recent">
      {days.map((day) => (
        <section key={day.label} className="mem-day" aria-label={day.label}>
          <h2 className="mem-day__label">{day.label}</h2>
          <ul className="mem-entries">
            {day.entries.map((e) => (
              <EntryRow key={e.key} entry={e} forceOpen={searching} />
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}
