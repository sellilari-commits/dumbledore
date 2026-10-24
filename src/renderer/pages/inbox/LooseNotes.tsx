/**
 * Loose notes on the Memory page (docs/NOTES.md §10.4): notes from casual reading that matched no
 * subject, newest first, with where they came from. Each can be filed under a subject
 * ('notes.file', unplaced in that subject until consolidation places it) or deleted with its ✕.
 * The section hides itself when there are none.
 */
import { IconButton, Section, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatRelative } from '@renderer/lib/format'
import { useLooseNotes } from '@renderer/lib/memory-queries'
import { useAction } from '@renderer/lib/queries'
import type { Note, SubjectSummary } from '@shared/domain'
import { Highlighter, StickyNote, X } from 'lucide-react'
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
    <li className="ib-loose" data-kind={note.kind}>
      {note.kind === 'highlight' ? (
        <Highlighter
          className="ib-loose__mark"
          size={13}
          strokeWidth={1.75}
          aria-label="Highlight"
        />
      ) : (
        <span className="ib-loose__dot" aria-hidden />
      )}
      <div className="ib-loose__body">
        <span className="ib-loose__text">{note.text}</span>
        <span className="ib-loose__meta">
          {[note.source.title ?? note.source.app, formatRelative(note.createdAt)].join(' · ')}
        </span>
      </div>
      <SubjectMenu
        label={`File “${note.text.slice(0, 40)}” under a subject`}
        heading="File under"
        subjects={subjects}
        value={null}
        disabled={file.isPending}
        align="end"
        onPick={(subjectId) => file.mutate({ id: note.id, subjectId, conceptId: null })}
      >
        File
      </SubjectMenu>
      <IconButton
        label="Delete note"
        size="sm"
        className="ib-loose__del"
        onClick={() => remove.mutate(note.id)}
      >
        <X size={14} strokeWidth={1.75} />
      </IconButton>
    </li>
  )
}

export function LooseNotes({ subjects }: { subjects: SubjectSummary[] }) {
  const notes = useLooseNotes()
  if (!notes.data || notes.data.length === 0) return null
  return (
    <Section
      id="inbox-loose"
      title="Loose notes"
      icon={<StickyNote size={14} strokeWidth={1.75} />}
    >
      <ul className="ib-loose-list" aria-label="Loose notes">
        {notes.data.map((n) => (
          <LooseNote key={n.id} note={n} subjects={subjects} />
        ))}
      </ul>
    </Section>
  )
}
