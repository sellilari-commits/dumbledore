/**
 * The subject page's two judgement sections. Progress: where the roadmap stands (step, bar,
 * the step you're on), how many concepts are mastered and which are strong, and the latest exam
 * results with "Test me"; without a roadmap (or once it is finished), a button that plans one.
 * Your gaps: see GapsSection.
 */
import { Button, ProgressBar, Section, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { formatMinutes, formatRelative } from '@renderer/lib/format'
import { keys, useAction } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { Concept } from '@shared/domain'
import type { GapNote, SubjectDetail } from '@shared/state'
import { useQueryClient } from '@tanstack/react-query'
import { CircleAlert, FilePenLine, Map as MapIcon, TrendingUp } from 'lucide-react'
import { useLocation } from 'wouter'
import { NoChatChoice, useChatPrompt } from '../NoChatChoice'
import { RoadmapHistory } from './RoadmapHistory'
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
      <RoadmapHistory subjectId={detail.subject.id} />
      {concepts.length > 0 ? (
        <p className="sp-progress-mastery">
          {mastered} of {concepts.length} topics mastered
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

const BREVITY =
  'No greetings or small talk. Short structured bullets, max ~150 words, bold key terms.'

/** A prompt for the student's AI that starts from exactly what went wrong on this topic. */
export function fixPromptFor(subject: string, topic: string, notes: readonly GapNote[]): string {
  const thought = notes.filter((n) => n.kind === 'misconception').slice(0, 3)
  const asked = notes.filter((n) => n.kind === 'question').slice(0, 2)
  const lines = [`I'm studying ${subject} and I'm stuck on ${topic}.`]
  for (const n of thought) lines.push(`In a quiz I thought: ${n.text.replace(/[.!]+$/, '')}.`)
  for (const n of asked) lines.push(`My question: ${n.text}`)
  lines.push(
    "1) Explain what's right and, where I was wrong, why. 2) Give one concrete example. 3) Then ask me one question to check I got it, and wait.",
    BREVITY,
  )
  return lines.join(' ')
}

function GapRow({
  concept,
  notes,
  subjectName,
}: {
  concept: Concept
  notes: readonly GapNote[]
  subjectName: string
}) {
  const run = useAction('coach.runAction')
  const chat = useChatPrompt()
  const study = () =>
    run.mutate(
      { type: 'start_roadmap', subjectId: concept.subjectId, goal: concept.name },
      {
        onSuccess: () => toast(`Building a roadmap for ${concept.name}…`),
        onError: (err) => errorToast(err),
      },
    )
  const fix = () =>
    chat.send(fixPromptFor(subjectName, concept.name, notes), (r) =>
      r.ok
        ? toast('Pasted into your AI chat', { tone: 'success' })
        : errorToast(new Error(r.reason ?? 'Could not paste.')),
    )
  const why =
    concept.struggleCount > 0
      ? // Wrong quiz answers and confused reading or chats both count.
        `Stuck on it ${concept.struggleCount === 1 ? 'once' : `${concept.struggleCount} times`}`
      : concept.status === 'struggling' || concept.status === 'learning'
        ? `${Math.round(concept.mastery * 100)}% there`
        : 'Open question'
  return (
    <li className="sp-gap">
      <div className="sp-gap__text">
        <span className="sp-gap__name">{concept.name}</span>
        <span className="sp-gap__meta">
          <span className="sp-gap__why">{why}</span>
          {concept.summary ? ` · ${concept.summary}` : null}
        </span>
        {notes.length > 0 ? (
          <ul className="sp-gap__notes">
            {notes.slice(0, 4).map((n) => (
              <li key={n.id} title={n.source}>
                <span className="sp-gap__label">
                  {n.kind === 'misconception' ? 'You thought' : 'You asked'}
                </span>{' '}
                {n.text}
              </li>
            ))}
          </ul>
        ) : null}
        {chat.noChat ? (
          <NoChatChoice
            size="xs"
            noChat={chat.noChat}
            opening={chat.opening}
            onOpen={chat.open}
            onCopy={chat.copy}
          />
        ) : null}
      </div>
      <div className="sp-gap__actions">
        <Button
          size="xs"
          variant="ghost"
          loading={chat.sending}
          onClick={fix}
          aria-label={`Fix ${concept.name} with your AI`}
        >
          Fix it
        </Button>
        <Button
          size="xs"
          variant="ghost"
          loading={run.isPending}
          onClick={study}
          aria-label={`Study ${concept.name}`}
        >
          Study this
        </Button>
      </div>
    </li>
  )
}

/**
 * Your gaps: the topics that keep not clicking, weakest first, each with what an exam showed the
 * student believed ("You thought …") and what they asked Dumbledore ("You asked …"); then topics
 * with only an open question. "Fix it" pastes a prompt built from exactly that into the open AI
 * chat (with none open: "ChatGPT isn't open. [Open ChatGPT and paste] [Copy]" under the topic),
 * "Study this" plans a roadmap for the topic.
 */
export function GapsSection({ detail }: { detail: SubjectDetail }) {
  const notes = detail.gapNotes ?? []
  const notesOf = (id: string) => notes.filter((n) => n.conceptId === id)
  const gaps = gapsOf(detail.concepts)
  const gapIds = new Set(gaps.map((c) => c.id))
  const asked = detail.concepts.filter(
    (c) => !gapIds.has(c.id) && notes.some((n) => n.conceptId === c.id && n.kind === 'question'),
  )
  const rows = [...gaps, ...asked]
  const loose = notes.filter((n) => n.conceptId === null && n.kind === 'question')
  return (
    <Section id="subject-gaps" title="Your gaps" icon={<CircleAlert {...HEAD} />}>
      {rows.length === 0 && loose.length === 0 ? (
        <p className="sp-quiet">
          No gaps found yet. They show up here when a quiz answer misses, something doesn’t click,
          or you tell Dumbledore you don’t get it (double-tap right ⌥).
        </p>
      ) : (
        <ul className="sp-gaps">
          {rows.map((c) => (
            <GapRow
              key={c.id}
              concept={c}
              notes={notesOf(c.id)}
              subjectName={detail.subject.name}
            />
          ))}
          {loose.length > 0 ? (
            <li className="sp-gap">
              <div className="sp-gap__text">
                <span className="sp-gap__name">Open questions</span>
                <ul className="sp-gap__notes">
                  {loose.slice(0, 5).map((n) => (
                    <li key={n.id} title={n.source}>
                      <span className="sp-gap__label">You asked</span> {n.text}
                    </li>
                  ))}
                </ul>
              </div>
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  )
}
