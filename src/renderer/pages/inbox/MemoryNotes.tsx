/**
 * Notes on the Memory page: a note bullet (flag for a highlight, pen for a typed note) with ✏️,
 * "Move to…" (another subject or topic, NoteFileMenu; the move sticks) and ✕ on hover, its source line linking to the page it came from, and a page group that shows the
 * page once when several notes came from it. Links open in the default browser: the window's
 * open handler sends http(s) links to shell.openExternal (main/security.ts).
 */

import { IconButton, Textarea, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { noteLead } from '@renderer/lib/status'
import type { Note } from '@shared/domain'
import { Flag, FolderInput, Pencil, PenLine, X } from 'lucide-react'
import { useState } from 'react'
import { isTyped, type PageGroup, type SourceLink, shortAgo, sourceLink } from './memory-model'
import { NoteFileMenu } from './NoteFileMenu'

const report = (err: Error) => errorToast(err)

export function SourceLine({ source, at }: { source: SourceLink; at: string }) {
  const meta = [source.app, at ? shortAgo(at) : null].filter(Boolean).join(' · ')
  return (
    <span className="mem-source">
      {source.href ? (
        <a
          className="mem-source__link"
          href={source.href}
          target="_blank"
          rel="noreferrer noopener"
          title={source.href}
        >
          {source.label}
        </a>
      ) : (
        <span className="mem-source__app">{source.label}</span>
      )}
      {meta && <span className="mem-source__meta"> · {meta}</span>}
    </span>
  )
}

function NoteMark({ note }: { note: Note }) {
  if (note.kind === 'highlight')
    return <Flag className="mem-note__mark" data-kind="flag" size={12} aria-label="Highlight" />
  if (isTyped(note))
    return <PenLine className="mem-note__mark" data-kind="typed" size={12} aria-label="Your note" />
  return <span className="mem-note__dot" aria-hidden />
}

export function NoteItem({ note, showSource }: { note: Note; showSource: boolean }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(note.text)
  const update = useAction('notes.update', {
    onSuccess: () => setEditing(false),
    onError: report,
  })
  const remove = useAction('notes.delete', {
    onSuccess: () => toast('Note deleted', { tone: 'info' }),
    onError: report,
  })
  const save = () => {
    const text = draft.trim()
    if (!text || text === note.text) return setEditing(false)
    update.mutate({ id: note.id, text })
  }
  return (
    <li className="mem-note" data-kind={note.kind} data-testid="mem-note">
      <NoteMark note={note} />
      <div className="mem-note__body">
        {editing ? (
          <Textarea
            aria-label="Edit note"
            className="mem-note__edit"
            value={draft}
            autoFocus
            rows={Math.min(6, Math.max(2, Math.ceil(draft.length / 70)))}
            onChange={(e) => setDraft(e.currentTarget.value)}
            onBlur={save}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                save()
              }
              if (e.key === 'Escape') {
                setDraft(note.text)
                setEditing(false)
              }
            }}
          />
        ) : (
          <span className="mem-note__text">
            {noteLead(note.kind)}
            {note.text}
          </span>
        )}
        {showSource && !editing && <SourceLine source={sourceLink(note)} at={note.createdAt} />}
      </div>
      {!editing && (
        <span className="mem-note__actions">
          <IconButton label="Edit note" size="sm" onClick={() => setEditing(true)}>
            <Pencil size={13} strokeWidth={1.75} />
          </IconButton>
          <NoteFileMenu
            note={note}
            heading="Move to"
            trigger={
              <IconButton label="Move note to another topic" size="sm">
                <FolderInput size={13} strokeWidth={1.75} />
              </IconButton>
            }
          />
          <IconButton
            label="Delete note"
            size="sm"
            disabled={remove.isPending}
            onClick={() => remove.mutate(note.id)}
          >
            <X size={14} strokeWidth={1.75} />
          </IconButton>
        </span>
      )}
    </li>
  )
}

/** One page's notes: alone, a note carries its own source line; several share one page line. */
export function PageGroupView({ group }: { group: PageGroup }) {
  const only = group.notes.length === 1 ? group.notes[0] : undefined
  if (only) {
    return (
      <ul className="mem-notes">
        <NoteItem note={only} showSource />
      </ul>
    )
  }
  return (
    <div className="mem-page">
      <SourceLine source={group.source} at={group.at} />
      <ul className="mem-notes">
        {group.notes.map((n) => (
          <NoteItem key={n.id} note={n} showSource={false} />
        ))}
      </ul>
    </div>
  )
}

/** A topic's source: the page (link, app and time) once, its notes under it. */
export function SourceBlock({ group }: { group: PageGroup }) {
  return (
    <div className="mem-sourceblock" data-testid="mem-source">
      <SourceLine source={group.source} at={group.at} />
      {group.notes.length > 0 && (
        <ul className="mem-notes">
          {group.notes.map((n) => (
            <NoteItem key={n.id} note={n} showSource={false} />
          ))}
        </ul>
      )}
    </div>
  )
}
