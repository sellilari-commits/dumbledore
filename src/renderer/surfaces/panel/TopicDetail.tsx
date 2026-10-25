/**
 * A topic's detail inside the mini panel: back, the topic name and its own lock; then the
 * roadmap that covers it (each step with a plain state, checkpoints as small markers) and the
 * topic's flags — what the student highlighted or typed — each with a ✕. No roadmap: flags only.
 */

import { IconButton, Tooltip } from '@renderer/design-system'
import { invoke } from '@renderer/lib/api'
import { useSubjectTree } from '@renderer/lib/memory-queries'
import { keys, useAction } from '@renderer/lib/queries'
import { noteLead } from '@renderer/lib/status'
import type { Note, Roadmap, RoadmapItem } from '@shared/domain'
import type { Topic } from '@shared/topics'
import { useQuery } from '@tanstack/react-query'
import { Check, ChevronLeft, Flag, Lock, LockOpen, PenLine, X } from 'lucide-react'
import { useState } from 'react'
import { report } from './panel-actions'
import { SectionError, SectionLoading } from './Section'
import {
  STEP_LABEL,
  sourceLabel,
  stepState,
  timeAgo,
  topicConceptIds,
  topicFlags,
  topicRoadmap,
} from './topic-detail'
import type { PanelTopics } from './usePanelTopics'

export const EMPTY_FLAGS = 'Highlight text on any page to flag it here.'

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
  const locked = panel.locked && panel.current?.id === topic.id

  const concepts = detail.data?.concepts ?? []
  const ids = topicConceptIds(concepts, topic.id)
  const names = concepts.filter((c) => ids.has(c.id)).map((c) => c.name)
  const roadmap = topicRoadmap(detail.data?.roadmap ?? null, topic.name, names)
  const flags = topicFlags(tree.data, ids)
  const loading = detail.isLoading || tree.isLoading
  const error = detail.error ?? tree.error

  return (
    <section className="pn-detail" aria-label={topic.name}>
      <div className="pn-detail__head">
        <IconButton label="Back to topics" onClick={onBack}>
          <ChevronLeft size={16} strokeWidth={2} />
        </IconButton>
        <div className="pn-detail__title">
          <h2 className="pn-detail__name">{topic.name}</h2>
          <span className="pn-detail__subject">{topic.subjectName}</span>
        </div>
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
      </div>

      {loading ? (
        <SectionLoading lines={3} label="Loading this topic" />
      ) : error ? (
        <SectionError error={error} />
      ) : (
        <>
          {roadmap && <RoadmapSteps roadmap={roadmap} />}
          <Flags flags={flags} withHeading={roadmap !== null} />
        </>
      )}
    </section>
  )
}

function RoadmapSteps({ roadmap }: { roadmap: Roadmap }) {
  const done = roadmap.items.filter((i) => i.status === 'done').length
  return (
    <div className="pn-sec">
      <h3 className="pn-sec__head">
        Roadmap
        <span className="pn-sec__count">
          {done}/{roadmap.items.length}
        </span>
      </h3>
      <ol className="pn-steps" aria-label="Roadmap steps">
        {roadmap.items.map((item) => (
          <Step key={item.id} item={item} />
        ))}
      </ol>
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

function Flags({ flags, withHeading }: { flags: Note[]; withHeading: boolean }) {
  const remove = useAction('notes.delete', { onError: report })
  return (
    <div className="pn-sec">
      {withHeading && (
        <h3 className="pn-sec__head">
          Flags
          {flags.length > 0 && <span className="pn-sec__count">{flags.length}</span>}
        </h3>
      )}
      {flags.length === 0 ? (
        <p className="pn-empty pn-empty--inline">{EMPTY_FLAGS}</p>
      ) : (
        <ul className="pn-flags" aria-label="Flags">
          {flags.map((note) => (
            <FlagRow
              key={note.id}
              note={note}
              removing={remove.isPending && remove.variables === note.id}
              onRemove={() => remove.mutate(note.id)}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

function FlagRow({
  note,
  removing,
  onRemove,
}: {
  note: Note
  removing: boolean
  onRemove: () => void
}) {
  const [open, setOpen] = useState(false)
  const long = note.text.length > 140
  return (
    <li className="pn-flag" data-removing={removing || undefined}>
      <span className="pn-flag__icon" aria-hidden>
        {note.kind === 'highlight' ? (
          <Flag size={12} strokeWidth={2} />
        ) : (
          <PenLine size={12} strokeWidth={2} />
        )}
      </span>
      <div className="pn-flag__body">
        <p className="pn-flag__text" data-open={open || undefined}>
          {noteLead(note.kind)}
          {note.text}
        </p>
        <span className="pn-flag__meta">
          {sourceLabel(note)} · {timeAgo(note.createdAt)}
          {long && (
            <button type="button" className="pn-flag__more" onClick={() => setOpen(!open)}>
              {open ? 'Less' : 'More'}
            </button>
          )}
        </span>
      </div>
      <span className="pn-flag__remove">
        <IconButton label="Delete flag" size="sm" disabled={removing} onClick={onRemove}>
          <X size={13} strokeWidth={2} />
        </IconButton>
      </span>
    </li>
  )
}
