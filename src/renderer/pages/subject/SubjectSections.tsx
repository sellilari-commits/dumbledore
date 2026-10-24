/**
 * The subject page's two judgement sections. Progress: where the roadmap stands (step, bar,
 * the step you're on) and how many concepts are mastered; without a roadmap, a button that
 * starts one. Gaps: the concepts that keep not clicking, weakest first, each with "Study this"
 * (coach.runAction start_roadmap on that concept).
 */
import { Button, ProgressBar, Section, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatMinutes } from '@renderer/lib/format'
import { keys, useAction } from '@renderer/lib/queries'
import type { Concept } from '@shared/domain'
import type { SubjectDetail } from '@shared/state'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, Map as MapIcon, TrendingUp } from 'lucide-react'
import { roadmapProgress } from './subject-utils'

const HEAD = { size: 14, strokeWidth: 1.75 } as const

function StartRoadmap({ detail }: { detail: SubjectDetail }) {
  const { subject } = detail
  const qc = useQueryClient()
  const start = useAction('coach.runAction')
  const run = () =>
    start.mutate(
      { type: 'start_roadmap', subjectId: subject.id, goal: subject.goal ?? subject.name },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: keys.subject(subject.id) })
          toast('Planning your roadmap…')
        },
        onError: (err) => errorToast(err),
      },
    )
  return (
    <div className="sp-progress-empty">
      <p className="sp-quiet">
        No roadmap yet. Dumbledore plans short steps from what you already know, with a quick check
        after every few.
      </p>
      <Button size="sm" icon={<MapIcon size={14} />} loading={start.isPending} onClick={run}>
        Start a roadmap
      </Button>
    </div>
  )
}

export function ProgressSection({ detail }: { detail: SubjectDetail }) {
  const { roadmap, concepts } = detail
  const mastered = concepts.filter((c) => c.status === 'mastered').length
  const p = roadmap ? roadmapProgress(roadmap) : null
  const current = roadmap?.items.find((i) => i.status === 'current')
  return (
    <Section id="subject-progress" title="Progress" icon={<TrendingUp {...HEAD} />}>
      {roadmap && p ? (
        <div className="sp-progress-block">
          <div className="sp-progress-line">
            <span className="sp-progress-title">{roadmap.title}</span>
            <span className="sp-muted">
              {roadmap.status === 'done'
                ? `Finished · ${p.total} steps`
                : `Step ${Math.min(p.step, p.total)} of ${p.total} · about ${formatMinutes(roadmap.estimatedMinutes)}`}
            </span>
          </div>
          <ProgressBar value={p.total ? p.done / p.total : 0} label="Roadmap progress" />
          {current ? (
            <div className="sp-progress-now">
              Up next: <strong>{current.title}</strong>
            </div>
          ) : null}
        </div>
      ) : (
        <StartRoadmap detail={detail} />
      )}
      {concepts.length > 0 ? (
        <p className="sp-progress-mastery">
          {mastered} of {concepts.length} concepts mastered
        </p>
      ) : null}
    </Section>
  )
}

/** Struggling first (most misses first), then concepts still under half way. */
export function gapsOf(concepts: readonly Concept[]): Concept[] {
  const struggling = concepts
    .filter((c) => c.status === 'struggling')
    .sort((a, b) => b.struggleCount - a.struggleCount || a.mastery - b.mastery)
  const weak = concepts
    .filter((c) => c.status === 'learning' && c.mastery < 0.5)
    .sort((a, b) => a.mastery - b.mastery)
  return [...struggling, ...weak]
}

function GapRow({ concept }: { concept: Concept }) {
  const run = useAction('coach.runAction')
  const study = () =>
    run.mutate(
      { type: 'start_roadmap', subjectId: concept.subjectId, goal: concept.name },
      {
        onSuccess: () => toast(`Building a roadmap for ${concept.name}…`),
        onError: (err) => errorToast(err),
      },
    )
  const why =
    concept.struggleCount > 0
      ? `Missed ${concept.struggleCount} ${concept.struggleCount === 1 ? 'time' : 'times'}`
      : `${Math.round(concept.mastery * 100)}% there`
  return (
    <li className="sp-gap">
      <div className="sp-gap__text">
        <span className="sp-gap__name">{concept.name}</span>
        <span className="sp-gap__meta">
          <span className="sp-gap__why">{why}</span>
          {concept.summary ? ` · ${concept.summary}` : null}
        </span>
      </div>
      <Button
        size="xs"
        variant="ghost"
        loading={run.isPending}
        onClick={study}
        aria-label={`Study ${concept.name}`}
      >
        Study this
      </Button>
    </li>
  )
}

export function GapsSection({ concepts }: { concepts: readonly Concept[] }) {
  const gaps = gapsOf(concepts)
  return (
    <Section id="subject-gaps" title="Gaps" icon={<CircleAlert {...HEAD} />}>
      {gaps.length === 0 ? (
        <p className="sp-quiet">
          No gaps found yet. They show up here when a quiz answer misses or something doesn’t click.
        </p>
      ) : (
        <ul className="sp-gaps">
          {gaps.map((c) => (
            <GapRow key={c.id} concept={c} />
          ))}
        </ul>
      )}
    </Section>
  )
}
