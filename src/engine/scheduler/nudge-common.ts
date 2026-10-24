/**
 * Shared shapes and helpers for nudge candidates: the candidate record, the context they are
 * gathered from, and the subject gate (archived/muted subjects never nudge; focus weighs more).
 */
import type { Repos } from '@engine/contracts'
import type { CoachAction, Id, NudgeKind, Settings, Subject } from '@shared/domain'
import { type LocalTime, MINUTE_MS } from './local-time'
import { clampWords, wordCount } from './nudge-text'

export interface NudgeCandidate {
  kind: NudgeKind
  dedupeKey: string
  value: number
  facts: string
  fallback: { title: string; body: string }
  action: CoachAction | null
  subjectId: Id | null
}

export interface FollowUp {
  roadmapId: Id
  completedAt: number
}

export interface CandidateContext {
  repos: Repos
  nowMs: number
  lt: LocalTime
  settings: Settings
  followUps: readonly FollowUp[]
  habitsToCoach: readonly string[]
}

export interface SubjectGate {
  allowed(subjectId: Id | null): boolean
  weight(subjectId: Id | null): number
  get(subjectId: Id): Subject | null
}

export const FOLLOW_UP_WINDOW = { fromMs: 30 * MINUTE_MS, toMs: 60 * MINUTE_MS }

export function subjectGate(repos: Repos, settings: Settings): SubjectGate {
  const subjects = new Map(repos.subjects.list({ status: ['active'] }).map((s) => [s.id, s]))
  const focusId = settings.focusSubjectId
  return {
    allowed: (id) => id === null || (subjects.get(id)?.focus ?? 'muted') !== 'muted',
    weight(id) {
      const s = id ? subjects.get(id) : undefined
      if (!s) return 1
      if (s.focus === 'focus' || focusId === s.id) return 1.15
      return focusId ? 0.85 : 1
    },
    get: (id) => subjects.get(id) ?? null,
  }
}

export const capValue = (v: number): number => Math.min(1, Math.max(0, v))

/** A title of ≤ 6 words: the name shortened so the suffix always fits. */
export const titleWith = (name: string, suffix: string): string =>
  `${clampWords(name, Math.max(1, 6 - wordCount(suffix)))} ${suffix}`

export const dayKeyOf = (ctx: CandidateContext): string => ctx.lt.dayKey(ctx.nowMs)

export function dueConcepts(ctx: CandidateContext, gate: SubjectGate, atMs = ctx.nowMs) {
  return ctx.repos.concepts
    .listDue(new Date(atMs).toISOString(), 200)
    .filter((c) => gate.allowed(c.subjectId))
}
