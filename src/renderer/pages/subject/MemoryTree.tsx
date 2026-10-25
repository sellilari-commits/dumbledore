/**
 * What Dumbledore caught (docs/NOTES.md §7): the subject's memory as a topic tree. Each topic shows its
 * status, a summary and the notes Dumbledore kept for it, with where each came from. Everything
 * is the student's to correct: rename a topic or edit its summary inline, edit a note (it becomes
 * pinned, so consolidation never rewrites it), delete a note with its ✕, delete a topic after a
 * light confirm (its notes go, its subtopics move up). "Needs first" lines show prerequisite
 * edges, read-only. Notes not placed on a topic yet are listed at the end.
 */
import {
  Button,
  Dialog,
  EmptyState,
  ErrorState,
  IconButton,
  LoadingState,
  Tag,
  toast,
} from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatPercent, formatRelative } from '@renderer/lib/format'
import { useSubjectTree } from '@renderer/lib/memory-queries'
import { useAction } from '@renderer/lib/queries'
import { MASTERY, noteLead } from '@renderer/lib/status'
import type { ConceptEdge, Note } from '@shared/domain'
import type { ConceptNode } from '@shared/state'
import { Highlighter, Puzzle, Trash2, X } from 'lucide-react'
import { type CSSProperties, type KeyboardEvent, useState } from 'react'
import { EditableText } from './EditableText'
import { depthsOf } from './subject-utils'

const report = (err: Error) => errorToast(err)

function NoteRow({ note }: { note: Note }) {
  const [draft, setDraft] = useState<string | null>(null)
  const update = useAction('notes.update', { onError: report })
  const remove = useAction('notes.delete', {
    onSuccess: () => toast('Note deleted', { tone: 'info' }),
    onError: report,
  })
  const save = () => {
    const text = draft?.trim() ?? ''
    setDraft(null)
    if (text && text !== note.text) update.mutate({ id: note.id, text })
  }
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      save()
    } else if (e.key === 'Escape') setDraft(null)
  }
  const meta = [
    note.source.title ?? note.source.app,
    formatRelative(note.createdAt),
    note.pinned ? 'edited' : null,
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <li className="tt-note" data-kind={note.kind}>
      {note.kind === 'highlight' ? (
        <Highlighter
          className="tt-note__mark"
          size={13}
          strokeWidth={1.75}
          aria-label="Highlight"
        />
      ) : (
        <span className="tt-note__dot" aria-hidden />
      )}
      <div className="tt-note__body">
        {draft !== null ? (
          <textarea
            className="tt-note__input"
            aria-label="Edit note"
            value={draft}
            maxLength={200}
            rows={2}
            // biome-ignore lint/a11y/noAutofocus: the student just clicked the note to edit it
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={onKey}
            onBlur={save}
          />
        ) : (
          <button
            type="button"
            className="tt-note__text"
            aria-label={`Edit note: ${note.text}`}
            onClick={() => setDraft(note.text)}
          >
            {noteLead(note.kind)}
            {note.text}
          </button>
        )}
        <span className="tt-note__meta">{meta}</span>
      </div>
      <IconButton
        label="Delete note"
        size="sm"
        className="tt-del"
        onClick={() => remove.mutate(note.id)}
      >
        <X size={14} strokeWidth={1.75} />
      </IconButton>
    </li>
  )
}

function NoteList({ notes }: { notes: Note[] }) {
  if (notes.length === 0) return null
  return (
    <ul className="tt-notes">
      {notes.map((n) => (
        <NoteRow key={n.id} note={n} />
      ))}
    </ul>
  )
}

function DeleteTopicDialog({ node, onClose }: { node: ConceptNode | null; onClose: () => void }) {
  const remove = useAction('concepts.delete', {
    onSuccess: () => {
      toast(`${node?.concept.name ?? 'Topic'} is deleted.`, { tone: 'success' })
      onClose()
    },
    onError: report,
  })
  const n = node?.notes.length ?? 0
  return (
    <Dialog
      open={node !== null}
      onOpenChange={(open) => !open && !remove.isPending && onClose()}
      title={`Delete ${node?.concept.name ?? 'topic'}?`}
      description={`${n === 0 ? 'It has no notes.' : n === 1 ? 'Its note goes too.' : `Its ${n} notes go too.`} Subtopics move up a level.`}
      footer={
        <>
          <Button onClick={onClose} disabled={remove.isPending}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={remove.isPending}
            onClick={() => node && remove.mutate(node.concept.id)}
          >
            Delete
          </Button>
        </>
      }
    >
      {null}
    </Dialog>
  )
}

function TopicBlock({
  node,
  depth,
  needs,
  onDelete,
}: {
  node: ConceptNode
  depth: number
  needs: string[]
  onDelete: () => void
}) {
  const { concept, notes } = node
  const update = useAction('concepts.update', { onError: report })
  const status = MASTERY[concept.status]
  return (
    <section
      className="tt-topic"
      aria-label={concept.name}
      style={{ '--tt-depth': depth } as CSSProperties}
    >
      <div className="tt-topic__head">
        <EditableText
          className="tt-topic__name"
          label="Topic name"
          value={concept.name}
          onSave={(name) => name !== concept.name && update.mutate({ id: concept.id, name })}
        />
        <Tag color={status.color} dot>
          {status.label}
        </Tag>
        {concept.mastery > 0 ? (
          <span className="tt-muted">{formatPercent(concept.mastery)}</span>
        ) : null}
        <IconButton
          label={`Delete topic ${concept.name}`}
          size="sm"
          className="tt-del"
          onClick={onDelete}
        >
          <Trash2 size={14} strokeWidth={1.75} />
        </IconButton>
      </div>
      <EditableText
        className="tt-topic__summary"
        label={`Summary of ${concept.name}`}
        placeholder="Add a summary"
        allowEmpty
        value={concept.summary}
        onSave={(summary) =>
          summary !== concept.summary && update.mutate({ id: concept.id, summary })
        }
      />
      {needs.length > 0 ? <p className="tt-needs">Needs first: {needs.join(', ')}</p> : null}
      <NoteList notes={notes} />
    </section>
  )
}

/** Names of the topics that must come before each topic (edge from → to). */
function needsOf(nodes: ConceptNode[], edges: ConceptEdge[]): Map<string, string[]> {
  const names = new Map(nodes.map((n) => [n.concept.id, n.concept.name]))
  const out = new Map<string, string[]>()
  for (const e of edges) {
    const name = names.get(e.fromId)
    if (!name) continue
    out.set(e.toId, [...(out.get(e.toId) ?? []), name])
  }
  return out
}

export function MemoryTree({ subjectId }: { subjectId: string }) {
  const tree = useSubjectTree(subjectId)
  const [deleting, setDeleting] = useState<ConceptNode | null>(null)

  if (tree.isLoading) return <LoadingState caption="Loading topics and notes…" lines={5} />
  if (tree.isError || !tree.data)
    return (
      <ErrorState
        title="Couldn’t load the topics"
        error={tree.error}
        onRetry={() => void tree.refetch()}
      />
    )
  const { concepts, unplaced, edges } = tree.data
  if (concepts.length === 0 && unplaced.length === 0)
    return (
      <EmptyState icon={<Puzzle size={28} strokeWidth={1.5} />} title="No topics yet">
        Dumbledore adds topics and notes as you read, highlight and chat about this subject. You can
        edit or delete any of them here.
      </EmptyState>
    )
  const depths = depthsOf(concepts.map((n) => n.concept))
  const needs = needsOf(concepts, edges)
  return (
    <div className="tt">
      {concepts.map((node) => (
        <TopicBlock
          key={node.concept.id}
          node={node}
          depth={depths.get(node.concept.id) ?? 0}
          needs={needs.get(node.concept.id) ?? []}
          onDelete={() => setDeleting(node)}
        />
      ))}
      {unplaced.length > 0 ? (
        <section className="tt-topic tt-unplaced" aria-label="Not in a topic yet">
          <div className="tt-topic__head">
            <span className="tt-unplaced__title">Not in a topic yet</span>
          </div>
          <NoteList notes={unplaced} />
        </section>
      ) : null}
      <DeleteTopicDialog node={deleting} onClose={() => setDeleting(null)} />
    </div>
  )
}
