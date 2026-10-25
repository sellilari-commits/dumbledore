/**
 * Loose notes on the Memory page (docs/NOTES.md §10.4): notes from reading that matched no subject,
 * newest first, as compact rows with their source link, "File to…" ('notes.file') and ✕. Shown
 * only when there are any.
 */

import { IconButton, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { noteLead } from '@renderer/lib/status'
import type { Note, SubjectSummary } from '@shared/domain'
import { Flag, X } from 'lucide-react'
import { SourceLine } from './MemoryNotes'
import { sourceLink } from './memory-model'
import { SubjectMenu } from './SubjectMenu'

const report = (err: Error) => errorToast(err)

function LooseNote({ note, subjects }: { note: Note; subjects: SubjectSummary[] }) {
  const file = useAction('notes.file', {
    onSuccess: (_n, { subjectId }) => {
      const s = subjects.find((x) => x.id === subjectId)
      toast(s ? `Filed under ${s.emoji} ${s.name}` : 'Filed', { tone: 'success' })
    },
    onError: report,
  })
  const remove = useAction('notes.delete', {
    onSuccess: () => toast('Note deleted', { tone: 'info' }),
    onError: report,
  })
  return (
    <li className="mem-loose" data-kind={note.kind} data-testid="mem-loose">
      {note.kind === 'highlight' ? (
        <Flag className="mem-note__mark" data-kind="flag" size={12} aria-label="Highlight" />
      ) : (
        <span className="mem-note__dot" aria-hidden />
      )}
      <div className="mem-note__body">
        <span className="mem-note__text">
          {noteLead(note.kind)}
          {note.text}
        </span>
        <SourceLine source={sourceLink(note)} at={note.createdAt} />
      </div>
      <SubjectMenu
        label={`File “${note.text.slice(0, 40)}” to a subject`}
        heading="File to"
        subjects={subjects}
        value={null}
        disabled={file.isPending || subjects.length === 0}
        align="end"
        className="mem-loose__file"
        onPick={(subjectId) => file.mutate({ id: note.id, subjectId, conceptId: null })}
      >
        File to…
      </SubjectMenu>
      <IconButton
        label="Delete note"
        size="sm"
        className="mem-loose__del"
        disabled={remove.isPending}
        onClick={() => remove.mutate(note.id)}
      >
        <X size={14} strokeWidth={1.75} />
      </IconButton>
    </li>
  )
}

export function LooseNotes({ notes, subjects }: { notes: Note[]; subjects: SubjectSummary[] }) {
  if (notes.length === 0) return null
  return (
    <section className="mem-loose-section" aria-label="Loose notes">
      <h2 className="mem-section-label">Loose notes</h2>
      <ul className="mem-loose-list">
        {notes.map((n) => (
          <LooseNote key={n.id} note={n} subjects={subjects} />
        ))}
      </ul>
    </section>
  )
}
