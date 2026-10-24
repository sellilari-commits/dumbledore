/**
 * Daily anchors and coaching tips (PLAN §6.6): the opt-in morning plan (first good moment between
 * 07:00 and 11:00: "2 reviews due, midterm in 9 days → a 16-minute plan"), the opt-in evening wrap
 * (19:45–22:30: today's questions and accuracy, misses to fix, reviews due tomorrow), and
 * occasional prompting tips from the student's prompt habits and the profiler's advice.
 */
import type { CoachAction, Quiz } from '@shared/domain'
import { DAY_MS, parseDeadline, weekKey } from './local-time'
import {
  type CandidateContext,
  dayKeyOf,
  dueConcepts,
  type NudgeCandidate,
  type SubjectGate,
} from './nudge-common'
import { clampWords, plural } from './nudge-text'

export const MORNING_WINDOW = { from: 7 * 60, to: 11 * 60 }
export const EVENING_WINDOW = { from: 19 * 60 + 45, to: 22 * 60 + 30 }
const PLAN_HORIZON_DAYS = 14

const inWindow = (ctx: CandidateContext, w: { from: number; to: number }) => {
  const minute = ctx.lt.minuteOfDay(ctx.nowMs)
  return minute >= w.from && minute < w.to
}

function nearestDeadline(ctx: CandidateContext, gate: SubjectGate) {
  const { repos, lt, nowMs } = ctx
  const options = [
    ...repos.subjects
      .list({ status: ['active'] })
      .map((s) => ({ name: s.name, subjectId: s.id, at: parseDeadline(s.deadline, lt) })),
    ...repos.assignments
      .list({ status: 'open' })
      .map((a) => ({ name: a.title, subjectId: a.subjectId, at: parseDeadline(a.dueAt, lt) })),
  ]
  let best: { name: string; subjectId: string | null; days: number } | null = null
  for (const o of options) {
    if (o.at === null || o.at <= nowMs || !gate.allowed(o.subjectId)) continue
    const days = Math.round((lt.dayStart(o.at) - lt.dayStart(nowMs)) / DAY_MS)
    if (days > PLAN_HORIZON_DAYS || (best && best.days <= days)) continue
    best = { name: o.name, subjectId: o.subjectId, days }
  }
  return best
}

export function morningPlan(ctx: CandidateContext, gate: SubjectGate): NudgeCandidate | null {
  if (!ctx.settings.coaching.morningPlan || !inWindow(ctx, MORNING_WINDOW)) return null
  const due = dueConcepts(ctx, gate)
  const deadline = nearestDeadline(ctx, gate)
  const roadmap = ctx.repos.roadmaps.listActive().find((r) => gate.allowed(r.subjectId)) ?? null
  if (due.length === 0 && !deadline && !roadmap) return null

  const parts: string[] = []
  if (due.length > 0) parts.push(`${plural(due.length, 'review')} due`)
  if (deadline) {
    const when =
      deadline.days <= 0 ? 'today' : deadline.days === 1 ? 'tomorrow' : `in ${deadline.days} days`
    parts.push(`${clampWords(deadline.name, 2)} deadline ${when}`)
  } else if (roadmap) parts.push(`${clampWords(roadmap.title, 3)} to continue`)
  const minutes = Math.min(30, Math.max(10, 3 * Math.min(due.length, 8) + (roadmap ? 10 : 0)))
  let action: CoachAction | null = null
  if (due.length > 0)
    action = { type: 'start_review', conceptIds: due.slice(0, 8).map((c) => c.id) }
  else if (roadmap) action = { type: 'open_subject', subjectId: roadmap.subjectId }
  else if (deadline?.subjectId) action = { type: 'open_subject', subjectId: deadline.subjectId }

  return {
    kind: 'morning_plan',
    dedupeKey: `morning:${dayKeyOf(ctx)}`,
    value: 0.9, // the anchor of the morning: it leads, the other nudges follow later
    facts: `due=${due.length}; deadline=${deadline ? `${deadline.name} in ${deadline.days} days` : 'none'}; roadmap=${roadmap?.title ?? 'none'}; minutes=${minutes}`,
    fallback: {
      title: 'Your plan for today',
      body: `${parts.join(', ')}. Start a ${minutes}-minute plan?`,
    },
    action,
    subjectId: action?.type === 'open_subject' ? action.subjectId : (due[0]?.subjectId ?? null),
  }
}

function answeredToday(quizzes: readonly Quiz[]) {
  return quizzes.flatMap((quiz) =>
    quiz.answers.flatMap((a) => {
      const q = quiz.questions.find((x) => x.id === a.questionId)
      return q ? [{ conceptId: q.conceptId, correct: a.chosenIndex === q.correctIndex }] : []
    }),
  )
}

export function eveningWrap(ctx: CandidateContext, gate: SubjectGate): NudgeCandidate | null {
  if (!ctx.settings.coaching.eveningWrap || !inWindow(ctx, EVENING_WINDOW)) return null
  const { repos, lt, nowMs } = ctx
  const startIso = new Date(lt.dayStart(nowMs)).toISOString()
  const quizzes = repos.quizzes
    .list({ limit: 100 })
    .filter((q) => q.completedAt !== null && q.completedAt >= startIso)
  const answers = answeredToday(quizzes)
  const topics = new Set(
    repos.encounters
      .list({ sinceIso: startIso, limit: 300 })
      .filter((e) => e.inboxState !== 'ignored')
      .map((e) => e.topicPath.at(-1) ?? e.seen.slice(0, 40)),
  )
  if (answers.length === 0 && topics.size === 0) return null

  const dueTomorrow = dueConcepts(ctx, gate, lt.dayStart(nowMs) + 2 * DAY_MS).length
  const missed = [
    ...new Set(answers.filter((a) => !a.correct && a.conceptId).map((a) => a.conceptId as string)),
  ]
  const right = Math.round(
    (100 * answers.filter((a) => a.correct).length) / Math.max(1, answers.length),
  )
  const tomorrow = `${plural(dueTomorrow, 'review')} due tomorrow.`
  let body: string
  if (answers.length === 0) body = `You explored ${plural(topics.size, 'topic')} today. ${tomorrow}`
  else if (missed.length > 0) {
    body = `${plural(answers.length, 'question')} today, ${right}% right. Fix the ${plural(missed.length, 'miss', 'misses')} now?`
  } else body = `${plural(answers.length, 'question')} today, ${right}% right. ${tomorrow}`

  return {
    kind: 'evening_wrap',
    dedupeKey: `evening:${dayKeyOf(ctx)}`,
    value: 0.8,
    facts: `questions=${answers.length}; correct_pct=${right}; topics=${topics.size}; misses=${missed.length}; due_tomorrow=${dueTomorrow}`,
    fallback: { title: "Today's wrap-up", body },
    action: missed.length > 0 ? { type: 'start_review', conceptIds: missed.slice(0, 8) } : null,
    subjectId: null,
  }
}

type TipKey = 'context' | 'structure' | 'quiz' | 'examples'

const TIP_TEXT: Record<TipKey, string> = {
  context: 'Start prompts with one line about your level — answers fit better.',
  structure: 'Ask for numbered steps — answers get shorter and clearer.',
  quiz: 'End prompts with "quiz me with one question" — it sticks better.',
  examples: 'Ask for one concrete example — abstract answers fade fast.',
}
const TIP_MATCH: Record<TipKey, RegExp> = {
  context: /context|level|background/i,
  structure: /structure|format|numbered|steps/i,
  quiz: /quiz|test|question/i,
  examples: /example/i,
}

/** One candidate per prompting habit worth coaching (each at most once a week). */
export function tips(ctx: CandidateContext): NudgeCandidate[] {
  const h = ctx.repos.profile.get().habits
  if (h.promptsSeen < 5) return []
  const share = (n: number) => n / h.promptsSeen
  const needs: TipKey[] = []
  if (share(h.withContext) < 0.4) needs.push('context')
  if (share(h.withStructure) < 0.3) needs.push('structure')
  if (h.askedToBeQuizzed === 0 && h.promptsSeen >= 8) needs.push('quiz')
  if (share(h.askedForExamples) < 0.2) needs.push('examples')
  const week = weekKey(ctx.nowMs, ctx.lt)
  return needs.map((key) => ({
    kind: 'tip' as const,
    dedupeKey: `tip:${key}:${week}`,
    value: ctx.habitsToCoach.some((t) => TIP_MATCH[key].test(t)) ? 0.35 : 0.3,
    facts: `habit=${key}; prompts_seen=${h.promptsSeen}; with_context=${h.withContext}; with_structure=${h.withStructure}; quizzed=${h.askedToBeQuizzed}; examples=${h.askedForExamples}`,
    fallback: { title: 'Prompting tip', body: TIP_TEXT[key] },
    action: null,
    subjectId: null,
  }))
}
