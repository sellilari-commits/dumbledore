/**
 * The subject page's two judgement sections. Progress: where the roadmap stands (step, bar,
 * the step you're on), how many concepts are mastered and which are strong, and the latest exam
 * results with "Test me"; without a roadmap (or once it is finished), a button that plans one. Gaps: the concepts that keep not clicking, weakest first, each with "Study this"
 * (coach.runAction start_roadmap on that concept).
 */
import { Button, ProgressBar, Section, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatMinutes, formatRelative } from '@renderer/lib/format'
import { keys, useAction } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { Concept } from '@shared/domain'
import type { SubjectDetail } from '@shared/state'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FilePenLine, Map as MapIcon, TrendingUp } from 'lucide-react'
import { useLocation } from 'wouter'
import { roadmapProgress } from './subject-utils'

const HEAD = { size: 14, strokeWidth: 1.75 } as const

function StartRoadmap({ detail, finished }: { detail: SubjectDetail; finished?: boolean }) {
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
        {finished
          ? 'Roadmap done. The next one starts from what you know now, gaps first.'
          : 'No roadmap yet. Dumbledore plans short steps from what you already know, with a quick check after every few.'}
      </p>
      <Button size="sm" icon={<MapIcon size={14} />} loading={start.isPending} onClick={run}>
        {finished ? 'Plan the next roadmap' : 'Start a roadmap'}
      </Button>
    </div>
  )
}

export function ProgressSection({ detail }: { detail: SubjectDetail }) {
  const { roadmap, concepts } = detail
  const mastered = concepts.filter((c) => c.status === 'mastered').length
  const strong = concepts
    .filter((c) => c.status === 'mastered' || c.mastery >= 0.7)
    .sort((a, b) => b.mastery - a.mastery)
    .slice(0, 4)
    .map((c) => c.name)
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
          {roadmap.status === 'done' ? <StartRoadmap detail={detail} finished /> : null}
        </div>
      ) : (
        <StartRoadmap detail={detail} />
      )}
      {concepts.length > 0 ? (
        <p className="sp-progress-mastery">
          {mastered} of {concepts.length} concepts mastered
          {strong.length > 0 ? (
            <>
              {' · '}Strong: <span className="sp-strong">{strong.join(', ')}</span>
            </>
          ) : null}
        </p>
      ) : null}
      <ExamResults detail={detail} />
    </Section>
  )
}

/** "Egyptian History · weak spots · 10 questions" → "weak spots · 10 questions" on its own page. */
function examLabel(title: string, subject: string): string {
  const parts = title.split(' · ').filter((p) => p.trim().toLowerCase() !== subject.toLowerCase())
  return parts.join(' · ') || title
}

/** The subject's finished exams, newest first, each opening its results; plus "Test me". */
function ExamResults({ detail }: { detail: SubjectDetail }) {
  const [, navigate] = useLocation()
  const openNewExam = useShell((s) => s.openNewExam)
  const done = detail.exams
    .filter((e) => e.completedAt && e.score !== null)
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, 3)
  const canTest = detail.subject.status === 'active'
  return (
    <div className="sp-exams">
      {done.length > 0 ? (
        <ul className="sp-exams__list" aria-label="Exam results">
          {done.map((e) => {
            const right = Math.round((e.score ?? 0) * e.questionCount)
            return (
              <li key={e.id}>
                <button
                  type="button"
                  className="sp-exam"
                  onClick={() => navigate(`/exams/${e.id}`)}
                >
                  <span className="sp-exam__title">{examLabel(e.title, detail.subject.name)}</span>
                  <span className="sp-exam__score">
                    {right}/{e.questionCount} · {Math.round((e.score ?? 0) * 100)}%
                  </span>
                  <span className="sp-muted">{formatRelative(e.completedAt ?? e.createdAt)}</span>
                </button>
              </li>
            )
          })}
        </ul>
      ) : (
        <p className="sp-quiet">
          No exams yet. A short exam shows what you know and what you miss — Dumbledore remembers it
          for your next study session.
        </p>
      )}
      {canTest ? (
        <Button
          size="sm"
          icon={<FilePenLine size={14} strokeWidth={1.75} />}
          onClick={() => openNewExam([detail.subject.id])}
        >
          Test me
        </Button>
      ) : null}
    </div>
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
      ? // Wrong quiz answers and confused reading or chats both count.
        `Stuck on it ${concept.struggleCount === 1 ? 'once' : `${concept.struggleCount} times`}`
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
