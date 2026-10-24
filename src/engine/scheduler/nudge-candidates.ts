/**
 * Nudge candidates (PLAN §6.6, F8): due reviews, struggling concepts, subject and assignment
 * deadlines (T−3 d, T−1 d), study-session follow-ups (30–60 min after), plus the daily anchors and
 * prompting tips from ./nudge-anchors. Each candidate carries a value (0..1), a dedupe key, facts
 * for the nudge writer, a template fallback (≤ 14 words, one call to action) and its action.
 */
import type { Id } from '@shared/domain'
import { DAY_MS, MINUTE_MS, parseDeadline } from './local-time'
import { eveningWrap, morningPlan, tips } from './nudge-anchors'
import {
  type CandidateContext,
  capValue,
  dayKeyOf,
  dueConcepts,
  FOLLOW_UP_WINDOW,
  type NudgeCandidate,
  type SubjectGate,
  subjectGate,
  titleWith,
} from './nudge-common'
import { clampWords, plural } from './nudge-text'

export type { CandidateContext, FollowUp, NudgeCandidate } from './nudge-common'

/** Whether today's morning plan already offered the due reviews (then a review nudge repeats it). */
function plannedReviewsToday(ctx: CandidateContext): boolean {
  const since = new Date(ctx.lt.dayStart(ctx.nowMs)).toISOString()
  return (
    ctx.repos.nudges.findByDedupeKey(`morning:${dayKeyOf(ctx)}`, since)?.action?.type ===
    'start_review'
  )
}

function dueReviews(ctx: CandidateContext, gate: SubjectGate): NudgeCandidate | null {
  const due = dueConcepts(ctx, gate)
  const first = due[0]
  if (!first || plannedReviewsToday(ctx)) return null
  const top = due.slice(0, 8)
  const struggling = due.filter((c) => c.status === 'struggling').length
  const name = clampWords(first.name, 4)
  const minutes = due.length > 6 ? 5 : 3
  return {
    kind: 'review_due',
    dedupeKey: `review:${dayKeyOf(ctx)}`,
    value: capValue(
      (0.45 + 0.08 * Math.min(due.length, 5) + (struggling > 0 ? 0.05 : 0)) *
        gate.weight(first.subjectId),
    ),
    facts: `due=${due.length}; concepts=${top
      .slice(0, 3)
      .map((c) => c.name)
      .join(', ')}; struggling=${struggling}; minutes=${minutes}`,
    fallback: {
      title: `${plural(due.length, 'review')} due`,
      body:
        due.length === 1
          ? `Quick ${minutes}-minute check on ${name}?`
          : `${minutes}-minute check on ${name} and ${due.length - 1} more?`,
    },
    action: { type: 'start_review', conceptIds: top.map((c) => c.id) },
    subjectId: first.subjectId,
  }
}

const times = (n: number): string => (n <= 1 ? 'once' : n === 2 ? 'twice' : `${n} times`)

/** A struggle nudge about this concept on either of the two previous days. */
function nudgedLately(ctx: CandidateContext, conceptId: Id): boolean {
  const since = new Date(ctx.nowMs - 3 * DAY_MS).toISOString()
  return [1, 2].some((back) => {
    const day = ctx.lt.dayKey(ctx.nowMs - back * DAY_MS)
    return ctx.repos.nudges.findByDedupeKey(`struggle:${conceptId}:${day}`, since) !== null
  })
}

/** The most struggled-with concept that is not due anyway, rotating away from recent nudges. */
function struggle(
  ctx: CandidateContext,
  gate: SubjectGate,
  dueIds: ReadonlySet<Id>,
): NudgeCandidate | null {
  const c = ctx.repos.concepts
    .listStruggling(20)
    .find((x) => gate.allowed(x.subjectId) && !dueIds.has(x.id) && !nudgedLately(ctx, x.id))
  if (!c) return null
  return {
    kind: 'struggle',
    dedupeKey: `struggle:${c.id}:${dayKeyOf(ctx)}`,
    value: capValue((0.45 + 0.1 * Math.min(c.struggleCount, 4)) * gate.weight(c.subjectId)),
    facts: `concept=${c.name}; struggled=${c.struggleCount}; mastery=${Math.round(c.mastery * 100)}%`,
    fallback: {
      title: titleWith(c.name, 'still tricky?'),
      body: `It tripped you up ${times(c.struggleCount)}. Try a 3-minute check?`,
    },
    action: { type: 'start_review', conceptIds: [c.id] },
    subjectId: c.subjectId,
  }
}

const whenLabel = (days: number): string =>
  days <= 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`

function deadlines(ctx: CandidateContext, gate: SubjectGate): NudgeCandidate[] {
  const { repos, lt, nowMs } = ctx
  const daysLeft = (t: number) => Math.round((lt.dayStart(t) - lt.dayStart(nowMs)) / DAY_MS)
  const out: NudgeCandidate[] = []
  for (const s of repos.subjects.list({ status: ['active'] })) {
    const t = parseDeadline(s.deadline, lt)
    if (t === null || t <= nowMs || !gate.allowed(s.id)) continue
    const days = daysLeft(t)
    if (days > 3) continue
    const last = days <= 1
    out.push({
      kind: 'deadline',
      dedupeKey: `deadline:subject:${s.id}:${last ? 'T-1' : 'T-3'}`,
      value: capValue((last ? 0.95 : 0.8) * gate.weight(s.id)),
      facts: `subject=${s.name}; deadline=${whenLabel(days)}; goal=${s.goal ?? 'none'}`,
      fallback: {
        title: titleWith(s.name, `deadline ${whenLabel(days)}`),
        body: last
          ? 'One last 5-question check on your weak spots?'
          : 'Start a 10-question exam on your weak spots?',
      },
      action: {
        type: 'create_exam',
        spec: { subjectIds: [s.id], count: last ? 5 : 10, focus: 'weak', difficulty: 'mixed' },
      },
      subjectId: s.id,
    })
  }
  for (const a of repos.assignments.list({ status: 'open' })) {
    const t = parseDeadline(a.dueAt, lt)
    if (t === null || t <= nowMs || !gate.allowed(a.subjectId)) continue
    if (a.subjectId && !gate.get(a.subjectId)) continue // archived or unknown subject
    const days = daysLeft(t)
    if (days > 3) continue
    const last = days <= 1
    out.push({
      kind: 'deadline',
      dedupeKey: `deadline:assignment:${a.id}:${last ? 'T-1' : 'T-3'}`,
      value: capValue((last ? 0.9 : 0.75) * gate.weight(a.subjectId)),
      facts: `assignment=${a.title}; course=${a.course ?? 'unknown'}; due=${whenLabel(days)}`,
      fallback: {
        title: titleWith(a.title, `due ${whenLabel(days)}`),
        body: 'Plan the next step now, while there is time?',
      },
      action: a.subjectId
        ? { type: 'open_subject', subjectId: a.subjectId }
        : { type: 'start_roadmap', subjectId: null, goal: a.title },
      subjectId: a.subjectId,
    })
  }
  return out
}

function followUps(ctx: CandidateContext, gate: SubjectGate): NudgeCandidate[] {
  const { repos, nowMs } = ctx
  const out: NudgeCandidate[] = []
  for (const f of ctx.followUps) {
    if (
      nowMs < f.completedAt + FOLLOW_UP_WINDOW.fromMs ||
      nowMs >= f.completedAt + FOLLOW_UP_WINDOW.toMs
    )
      continue
    const roadmap = repos.roadmaps.get(f.roadmapId)
    const subject = roadmap ? gate.get(roadmap.subjectId) : null
    if (!roadmap || !subject || !gate.allowed(subject.id)) continue
    const names = [
      ...new Set(roadmap.items.flatMap((i) => (i.kind === 'learn' ? i.concepts : i.covers))),
    ]
    const ids = names
      .map((n) => repos.concepts.findByName(subject.id, n)?.id)
      .filter((id): id is Id => Boolean(id))
      .slice(0, 8)
    out.push({
      kind: 'session_followup',
      dedupeKey: `followup:${roadmap.id}`,
      value: capValue(0.85 * gate.weight(subject.id)),
      facts: `session=${roadmap.title}; subject=${subject.name}; concepts=${names.slice(0, 3).join(', ')}; minutes_ago=${Math.round((nowMs - f.completedAt) / MINUTE_MS)}`,
      fallback: {
        title: 'Lock in your session',
        body: `2-minute check on ${clampWords(subject.name, 4)} while it's fresh?`,
      },
      action:
        ids.length > 0
          ? { type: 'start_review', conceptIds: ids }
          : {
              type: 'create_exam',
              spec: {
                subjectIds: [subject.id],
                count: 5,
                focus: 'everything',
                difficulty: 'mixed',
              },
            },
      subjectId: subject.id,
    })
  }
  return out
}

export function gatherCandidates(ctx: CandidateContext): NudgeCandidate[] {
  const gate = subjectGate(ctx.repos, ctx.settings)
  const review = dueReviews(ctx, gate)
  const dueIds = new Set(review?.action?.type === 'start_review' ? review.action.conceptIds : [])
  return [
    review,
    struggle(ctx, gate, dueIds),
    ...deadlines(ctx, gate),
    ...followUps(ctx, gate),
    morningPlan(ctx, gate),
    eveningWrap(ctx, gate),
    ...tips(ctx),
  ].filter((c): c is NudgeCandidate => c !== null)
}
