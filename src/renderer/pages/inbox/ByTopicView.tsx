/**
 * Memory · By topic: each subject as a section, its topics as rows that fold open (children
 * indented, a small understanding dot), and under a topic its notes grouped by the page they came
 * from. Hovering a topic offers rename (concepts.update) and delete with a confirm
 * (concepts.delete); the big picture (the topic summary) edits in place too, which pins it so
 * consolidation keeps the student's words. There is no IPC to move a topic to another subject,
 * so that is not offered.
 */
import { Button, Dialog, IconButton, Input, Textarea, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import type { Concept } from '@shared/domain'
import { ChevronRight, FileText, Pencil, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { PageGroupView, SourceBlock } from './MemoryNotes'
import { notesCount, type SubjectSection, sourcesCount, type TopicNode } from './memory-model'

const report = (err: Error) => errorToast(err)

const STATUS_LABEL = {
  new: 'New',
  learning: 'Learning',
  struggling: 'Struggling',
  mastered: 'Mastered',
} as const

/** The topic's big picture, with a pen on hover that edits it in place (Enter saves, Esc cancels). */
function BigPicture({ concept }: { concept: Concept }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(concept.summary)
  const update = useAction('concepts.update', {
    onSuccess: () => setEditing(false),
    onError: report,
  })
  const save = () => {
    const text = draft.trim()
    if (!text || text === concept.summary.trim()) {
      setDraft(concept.summary)
      return setEditing(false)
    }
    update.mutate({ id: concept.id, summary: text })
  }
  if (editing)
    return (
      <Textarea
        aria-label={`Big picture of ${concept.name}`}
        className="mem-topic__summary-edit"
        value={draft}
        autoFocus
        rows={Math.min(8, Math.max(2, Math.ceil(draft.length / 70)))}
        onChange={(e) => setDraft(e.currentTarget.value)}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            save()
          }
          if (e.key === 'Escape') {
            setDraft(concept.summary)
            setEditing(false)
          }
        }}
      />
    )
  return (
    <div className="mem-topic__picture">
      <p className="mem-topic__summary">{concept.summary.trim()}</p>
      <span className="mem-topic__picture-actions">
        <IconButton
          label={`Edit the big picture of ${concept.name}`}
          size="sm"
          onClick={() => {
            setDraft(concept.summary)
            setEditing(true)
          }}
        >
          <Pencil size={13} strokeWidth={1.75} />
        </IconButton>
      </span>
    </div>
  )
}

/**
 * "All extracted text": main writes everything captured about the topic (screen text by source,
 * what was extracted, notes) to a text file and opens it (concepts.openText).
 */
function AllTextLink({ concept }: { concept: Concept }) {
  const open = useAction('concepts.openText', { onError: report })
  return (
    <button
      type="button"
      className="mem-alltext"
      disabled={open.isPending}
      onClick={() => open.mutate(concept.id)}
      aria-label={`All extracted text about ${concept.name}`}
    >
      <FileText size={12} strokeWidth={1.75} aria-hidden />
      All extracted text
    </button>
  )
}

function TopicRow({ topic, forceOpen }: { topic: TopicNode; forceOpen: boolean }) {
  const { concept } = topic
  const [open, setOpen] = useState(true)
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState(concept.name)
  const [confirm, setConfirm] = useState(false)
  const rename = useAction('concepts.update', {
    onSuccess: () => setRenaming(false),
    onError: report,
  })
  const remove = useAction('concepts.delete', {
    onSuccess: () => {
      setConfirm(false)
      toast(`Deleted ${concept.name}`, { tone: 'info' })
    },
    onError: report,
  })
  const expanded = open || forceOpen
  const count = topic.pages.reduce((n, p) => n + p.notes.length, 0)
  const summary = concept.summary.trim()
  const saveName = () => {
    const next = name.trim()
    if (!next || next === concept.name) {
      setName(concept.name)
      return setRenaming(false)
    }
    rename.mutate({ id: concept.id, name: next })
  }
  return (
    <li className="mem-topic" data-depth={topic.depth} style={{ '--depth': topic.depth } as never}>
      <div className="mem-topic__row" data-testid="mem-topic">
        <button
          type="button"
          className="mem-topic__toggle"
          aria-expanded={expanded}
          aria-label={`${expanded ? 'Fold' : 'Open'} ${concept.name}`}
          onClick={() => setOpen((o) => !o)}
        >
          <ChevronRight size={14} strokeWidth={1.75} className="mem-topic__chev" />
        </button>
        <span
          className="mem-topic__dot"
          data-status={concept.status}
          title={STATUS_LABEL[concept.status]}
          role="img"
          aria-label={STATUS_LABEL[concept.status]}
        />
        {renaming ? (
          <Input
            aria-label="Topic name"
            className="mem-topic__rename"
            value={name}
            autoFocus
            onChange={(e) => setName(e.currentTarget.value)}
            onBlur={saveName}
            onKeyDown={(e) => {
              if (e.key === 'Enter') saveName()
              if (e.key === 'Escape') {
                setName(concept.name)
                setRenaming(false)
              }
            }}
          />
        ) : (
          <button type="button" className="mem-topic__name" onClick={() => setOpen((o) => !o)}>
            {concept.name}
          </button>
        )}
        <span className="mem-topic__count">
          {topic.pages.length > 0 ? sourcesCount(topic.pages.length) : ''}
          {count > 0 ? ` · ${notesCount(count)}` : ''}
        </span>
        <span className="mem-topic__actions">
          <IconButton label={`Rename ${concept.name}`} size="sm" onClick={() => setRenaming(true)}>
            <Pencil size={13} strokeWidth={1.75} />
          </IconButton>
          <IconButton label={`Delete ${concept.name}`} size="sm" onClick={() => setConfirm(true)}>
            <Trash2 size={13} strokeWidth={1.75} />
          </IconButton>
        </span>
      </div>
      {expanded && (
        <div className="mem-topic__body">
          {summary && <BigPicture concept={concept} />}
          {topic.pages.length > 0 && (
            <section className="mem-topic__sources" aria-label={`Sources for ${concept.name}`}>
              {topic.pages.map((g) => (
                <SourceBlock key={g.key} group={g} />
              ))}
            </section>
          )}
          <AllTextLink concept={concept} />
        </div>
      )}
      <Dialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Delete ${concept.name}?`}
        description="Its notes go with it; topics under it move up a level."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirm(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              loading={remove.isPending}
              onClick={() => remove.mutate(concept.id)}
            >
              Delete topic
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </li>
  )
}

export function SubjectBlock({
  section,
  searching,
}: {
  section: SubjectSection
  searching: boolean
}) {
  const { subject, topics, unplaced } = section
  return (
    <section className="mem-subject" aria-label={subject.name}>
      <h2 className="mem-subject__title">
        <span className="mem-subject__emoji" aria-hidden>
          {subject.emoji}
        </span>
        {subject.name}
      </h2>
      {topics.length === 0 && unplaced.length === 0 ? (
        <p className="mem-quiet">No topics yet.</p>
      ) : (
        <ul className="mem-topics">
          {topics.map((t) => (
            <TopicRow key={t.concept.id} topic={t} forceOpen={searching} />
          ))}
        </ul>
      )}
      {unplaced.length > 0 && (
        <div className="mem-unplaced">
          <span className="mem-unplaced__label">Not in a topic yet</span>
          {unplaced.map((g) => (
            <PageGroupView key={g.key} group={g} />
          ))}
        </div>
      )}
    </section>
  )
}
