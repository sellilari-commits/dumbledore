/**
 * A topic's detail inside the mini panel, top to bottom: back, the topic name, its subject and
 * its lock (the panel header's own lock hides while a detail is open: one lock on screen); its
 * subtopics as a tree in the topic list's look, always fully open (a name opens that subtopic's
 * detail, back and Esc go up one level); then the roadmap that covers it, "Your notes" (what the
 * student highlighted or typed) and "Extracted" (what Dumbledore read: facts from pages, outline
 * passages), each closed to one header line until clicked, like the app's Memory rows. Each note
 * is one line with its source and age under it; a click opens it in full, ✕ on hover deletes it.
 * What is open is remembered while the panel is open and forgotten when it hides.
 * Long text never widens the panel: it wraps (see topic-detail.css).
 */

import { IconButton, Tooltip } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { useSubjectTree } from '@renderer/lib/memory-queries'
import { keys, useAction } from '@renderer/lib/queries'
import { noteLead } from '@renderer/lib/status'
import type { Concept, Note, Roadmap, RoadmapItem } from '@shared/domain'
import type { Topic } from '@shared/topics'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, ChevronRight, Lock, LockOpen, X } from 'lucide-react'
import { type CSSProperties, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { report } from './panel-actions'
import { SectionError, SectionLoading } from './Section'
import {
  STEP_LABEL,
  sourceLabel,
  stepState,
  subtopicsOf,
  timeAgo,
  topicConceptIds,
  topicNotes,
  topicRoadmap,
} from './topic-detail'
import './topic-detail.css'
import type { PanelTopics } from './usePanelTopics'

export const EMPTY_FLAGS = 'Highlight text on any page to flag it here.'

type Level = Pick<Concept, 'id' | 'name'>

// What the student opened (sections and notes), kept while the panel is open. The panel window
// hides rather than closes, so hiding forgets it.
const opened = new Set<string>()
const listeners = new Set<() => void>()
const subscribe = (fn: () => void) => {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

/** Closes everything opened in the detail (the panel hid; also used between tests). */
export function forgetOpened(): void {
  opened.clear()
  for (const fn of listeners) fn()
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) forgetOpened()
  })
}

function useOpened(key: string): [boolean, () => void] {
  const open = useSyncExternalStore(subscribe, () => opened.has(key))
  const toggle = () => {
    if (opened.has(key)) opened.delete(key)
    else opened.add(key)
    for (const fn of listeners) fn()
  }
  return [open, toggle]
}

export function TopicDetail({
  topic,
  panel,
  onBack,
}: {
  topic: Topic
  panel: PanelTopics
  onBack: () => void
}) {
  const detail = useQuery({
    queryKey: keys.subject(topic.subjectId),
    queryFn: () => invoke('subjects.get', topic.subjectId),
  })
  const tree = useSubjectTree(topic.subjectId)
  const section = useRef<HTMLElement>(null)
  // The subtopics opened below the topic, outermost first.
  const [path, setPath] = useState<Level[]>([])

  const concepts = detail.data?.concepts ?? []
  // A subtopic deleted meanwhile closes itself (and anything opened under it).
  const known = detail.data ? path.findIndex((l) => !concepts.some((c) => c.id === l.id)) : -1
  const levels = known === -1 ? path : path.slice(0, known)
  const here: Level = levels.at(-1) ?? topic
  const parentName = levels.length > 1 ? levels.at(-2)?.name : topic.name
  const atTopic = levels.length === 0
  const locked = atTopic && panel.locked && panel.current?.id === topic.id

  const up = () => (atTopic ? onBack() : setPath(levels.slice(0, -1)))
  const open = (c: Concept) => setPath([...levels, { id: c.id, name: c.name }])

  // Esc goes up one level first (capture, so it runs before the panel's own Esc, which at the
  // topic takes it back to the list).
  const upRef = useRef(up)
  upRef.current = up
  useEffect(() => {
    if (atTopic) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || e.isComposing) return
      e.preventDefault()
      upRef.current()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [atTopic])

  // A new level starts at the top of the panel's scroll.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on each level change only
  useEffect(() => {
    const body = section.current?.closest('.pn-body')
    if (body) body.scrollTop = 0
  }, [here.id])

  const ids = topicConceptIds(concepts, here.id)
  const names = concepts.filter((c) => ids.has(c.id)).map((c) => c.name)
  const roadmap = topicRoadmap(detail.data?.roadmap ?? null, here.name, names)
  const subtopics = subtopicsOf(concepts, here.id)
  const notes = topicNotes(tree.data, new Set([here.id]))
  const loading = detail.isLoading || tree.isLoading
  const error = detail.error ?? tree.error

  return (
    <section ref={section} className="pn-detail" aria-label={here.name}>
      <div className="pn-detail__head">
        <IconButton label={atTopic ? 'Back to topics' : `Back to ${parentName}`} onClick={up}>
          <ChevronLeft size={16} strokeWidth={2} />
        </IconButton>
        <div className="pn-detail__title">
          <h2 className="pn-detail__name">{here.name}</h2>
          <span className="pn-detail__subject">{atTopic ? topic.subjectName : parentName}</span>
        </div>
        {atTopic && (
          <Tooltip content={locked ? 'Locked on this topic' : 'Lock this topic'}>
            <span className="pn-lock" data-on={locked || undefined}>
              <IconButton
                label={locked ? 'Unlock this topic' : 'Lock this topic'}
                aria-pressed={locked}
                onClick={() => (locked ? panel.unlock() : panel.lock(topic))}
              >
                {locked ? (
                  <Lock size={14} strokeWidth={2} fill="currentColor" fillOpacity={0.18} />
                ) : (
                  <LockOpen size={14} strokeWidth={1.75} />
                )}
              </IconButton>
            </span>
          </Tooltip>
        )}
      </div>

      {loading ? (
        <SectionLoading lines={3} label="Loading this topic" />
      ) : error ? (
        <SectionError error={error} />
      ) : (
        <div className="pn-detail__level" key={here.id}>
          {subtopics.length > 0 && (
            <ul className="pn-topics pn-subtopics" aria-label="Subtopics">
              {subtopics.map((c) => (
                <SubtopicRow key={c.id} concept={c} concepts={concepts} depth={0} onOpen={open} />
              ))}
            </ul>
          )}
          {roadmap && <RoadmapSteps level={here.id} roadmap={roadmap} />}
          <NoteSection level={here.id} title="Your notes" notes={notes.yours} empty={EMPTY_FLAGS} />
          {notes.extracted.length > 0 && (
            <NoteSection level={here.id} title="Extracted" notes={notes.extracted} />
          )}
        </div>
      )}
    </section>
  )
}

/** One subtopic in the tree, its children always shown indented under it; its name opens it. */
function SubtopicRow({
  concept,
  concepts,
  depth,
  onOpen,
}: {
  concept: Concept
  concepts: readonly Concept[]
  depth: number
  onOpen: (c: Concept) => void
}) {
  const children = subtopicsOf(concepts, concept.id)
  return (
    <li>
      <div className="pn-tree__row" style={{ '--pn-depth': depth } as CSSProperties}>
        <button type="button" className="pn-topic" onClick={() => onOpen(concept)}>
          <span className="pn-topic__name">{concept.name}</span>
        </button>
      </div>
      {children.length > 0 && (
        <ul className="pn-tree__children" aria-label={`Subtopics of ${concept.name}`}>
          {children.map((c) => (
            <SubtopicRow
              key={c.id}
              concept={c}
              concepts={concepts}
              depth={depth + 1}
              onOpen={onOpen}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

/** A section's header: closed it is one line (title and a short summary); a click opens it. */
function SectionHead({
  title,
  summary,
  open,
  onToggle,
}: {
  title: string
  summary: string
  open: boolean
  onToggle: () => void
}) {
  return (
    <h3 className="pn-sec__head">
      <button
        type="button"
        className="pn-sec__toggle"
        aria-expanded={open}
        aria-label={`${title}, ${summary}`}
        onClick={onToggle}
      >
        <ChevronRight className="pn-sec__chev" size={13} strokeWidth={2} aria-hidden />
        <span className="pn-sec__title">{title}</span>
        <span className="pn-sec__count">{summary}</span>
      </button>
    </h3>
  )
}

/** "step 3 of 6" at the current step, "all done" when every step is. */
export function roadmapSummary(roadmap: Roadmap): string {
  const total = roadmap.items.length
  const at = roadmap.items.findIndex((i) => {
    const state = stepState(i)
    return state === 'current' || state === 'waiting'
  })
  if (at !== -1) return `step ${at + 1} of ${total}`
  const done = roadmap.items.filter((i) => i.status === 'done').length
  return done === total ? 'all done' : `${done} of ${total} done`
}

function RoadmapSteps({ level, roadmap }: { level: string; roadmap: Roadmap }) {
  const [open, toggle] = useOpened(`${level}:roadmap`)
  return (
    <div className="pn-sec" data-open={open || undefined}>
      <SectionHead
        title="Roadmap"
        summary={roadmapSummary(roadmap)}
        open={open}
        onToggle={toggle}
      />
      {open && (
        <ol className="pn-steps" aria-label="Roadmap steps">
          {roadmap.items.map((item) => (
            <Step key={item.id} item={item} />
          ))}
        </ol>
      )}
    </div>
  )
}

function Step({ item }: { item: RoadmapItem }) {
  const state = stepState(item)
  const checkpoint = item.kind === 'checkpoint'
  return (
    <li
      className="pn-step"
      data-state={state}
      data-kind={item.kind}
      aria-current={state === 'current' || state === 'waiting' ? 'step' : undefined}
    >
      <span className="pn-step__mark" aria-hidden>
        {state === 'done' ? <Check size={11} strokeWidth={3} /> : null}
      </span>
      <span className="pn-step__text">
        <span className="pn-step__title">{item.title}</span>
        {checkpoint ? (
          <span className="pn-step__meta">Checkpoint · {item.nQuestions} questions</span>
        ) : state === 'waiting' || state === 'current' || state === 'skipped' ? (
          <span className="pn-step__meta">{STEP_LABEL[state]}</span>
        ) : null}
      </span>
      <span className="dd-sr-only">{STEP_LABEL[state]}</span>
    </li>
  )
}

/** Past this many, a section shows the newest few and "Show all (N)". */
export const NOTES_SHOWN = 5

function NoteSection({
  level,
  title,
  notes,
  empty,
}: {
  level: string
  title: string
  notes: Note[]
  empty?: string
}) {
  const remove = useAction('notes.delete', { onError: report })
  const [all, setAll] = useState(false)
  const [open, toggle] = useOpened(`${level}:${title}`)
  const shown = all || notes.length <= NOTES_SHOWN ? notes : notes.slice(0, NOTES_SHOWN)
  // Nothing to open: the header and one calm line.
  if (notes.length === 0) {
    return (
      <div className="pn-sec">
        <h3 className="pn-sec__head">{title}</h3>
        <p className="pn-empty pn-empty--inline">{empty}</p>
      </div>
    )
  }
  return (
    <div className="pn-sec" data-open={open || undefined}>
      <SectionHead title={title} summary={String(notes.length)} open={open} onToggle={toggle} />
      {!open ? null : (
        <ul className="pn-flags pn-notes" aria-label={title}>
          {shown.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              removing={remove.isPending && remove.variables === note.id}
              onRemove={() => remove.mutate(note.id)}
            />
          ))}
        </ul>
      )}
      {open && shown.length < notes.length && (
        <button type="button" className="pn-notes__all" onClick={() => setAll(true)}>
          Show all ({notes.length})
        </button>
      )}
    </div>
  )
}

function NoteRow({
  note,
  removing,
  onRemove,
}: {
  note: Note
  removing: boolean
  onRemove: () => void
}) {
  const [open, toggle] = useOpened(`note:${note.id}`)
  return (
    <li
      className="pn-flag pn-note"
      data-open={open || undefined}
      data-removing={removing || undefined}
    >
      <button type="button" className="pn-note__body" aria-expanded={open} onClick={toggle}>
        <span className="pn-note__text">
          {noteLead(note.kind)}
          {note.text}
        </span>
        <span className="pn-flag__meta">
          {sourceLabel(note)} · {timeAgo(note.createdAt)}
        </span>
      </button>
      <span className="pn-flag__remove">
        <IconButton label="Delete note" size="sm" disabled={removing} onClick={onRemove}>
          <X size={13} strokeWidth={2} />
        </IconButton>
      </span>
    </li>
  )
}
