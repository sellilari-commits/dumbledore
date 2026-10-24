/**
 * Mastery and spaced-repetition maths (docs/PLAN.md §6.6). Pure: no repos, no clock.
 *
 * - correct answer → m += (1 − m) · 0.3 · difficulty factor; wrong → m · 0.6 (+1 struggle)
 * - "struggling" encounter → m · 0.9 + struggle flag; reading raises m by ≤ 0.05 (never past 0.6)
 * - status: Struggling (flag) › Mastered (m ≥ 0.85 and 2 spaced reviews passed) › New (< 0.2) ›
 *   Learning
 * - Leitner boxes 1/3/7/16/35 days: correct on a due review → next box, wrong → box 1. Review days
 *   roll over at 04:00 local (like Anki), so "due tomorrow" means tomorrow morning.
 * - Deadlines pull reviews earlier: to T−3 d and T−1 d.
 */

import { DAY_MS, HOUR_MS, type LocalTime } from '@engine/scheduler/local-time'
import type { MasteryStatus, UnderstandingStatus } from '@shared/domain'

export const LEITNER_DAYS = [1, 3, 7, 16, 35] as const
export const MAX_BOX = 5
export const NEW_BELOW = 0.2
export const MASTERED_FROM = 0.85
/** Box 3 = the first pass (box 1) plus two passed spaced reviews (box 2, box 3). */
export const MASTERED_MIN_BOX = 3
export const ANSWER_GAIN = 0.3
export const WRONG_KEEP = 0.6
export const STRUGGLE_KEEP = 0.9
/** Reading alone never lifts mastery past this. */
export const READING_CEILING = 0.6
export const ROLLOVER_MS = 4 * HOUR_MS
/** A deadline anchor closer than this to the answer is skipped (no review right after one). */
export const MIN_REVIEW_LEAD_MS = 4 * HOUR_MS
/** Deadline ramp-up starts this long before a deadline. */
export const RAMP_WINDOW_MS = 3 * DAY_MS
/** Ramp-up never makes a concept due again sooner than this after it was last seen. */
export const RAMP_REST_MS = 12 * HOUR_MS

export interface MasteryState {
  mastery: number
  box: number
  nextReviewAt: number | null // epoch ms
  struggling: boolean
  struggleCount: number
}

export const clamp01 = (x: number): number => Math.min(1, Math.max(0, x))

/** Difficulty 1/2/3 → 0.75/1/1.25 (2 is the target difficulty). */
export function difficultyFactor(difficulty: number): number {
  const d = Number.isFinite(difficulty) ? Math.min(3, Math.max(1, Math.round(difficulty))) : 2
  return 0.5 + 0.25 * d
}

export function masteryAfterAnswer(m: number, correct: boolean, difficulty: number): number {
  return clamp01(
    correct ? m + (1 - m) * ANSWER_GAIN * difficultyFactor(difficulty) : m * WRONG_KEEP,
  )
}

function readingGain(m: number, cap: number, share: number): number {
  if (m >= READING_CEILING) return m
  return Math.min(READING_CEILING, m + Math.min(cap, (1 - m) * share))
}

export function masteryAfterEncounter(m: number, understanding: UnderstandingStatus): number {
  switch (understanding) {
    case 'struggling':
      return clamp01(m * STRUGGLE_KEEP)
    case 'understood':
      return readingGain(m, 0.05, 0.1)
    case 'unknown': // plain reading, no evidence either way
      return readingGain(m, 0.02, 0.05)
    case 'unclear':
      return m
  }
}

export function deriveStatus(
  s: Pick<MasteryState, 'mastery' | 'box' | 'struggling'>,
): MasteryStatus {
  if (s.struggling) return 'struggling'
  if (s.mastery >= MASTERED_FROM && s.box >= MASTERED_MIN_BOX) return 'mastered'
  if (s.mastery < NEW_BELOW) return 'new'
  return 'learning'
}

export const spacedReviewsPassed = (box: number): number => Math.max(0, box - 1)

export function intervalDays(box: number): number {
  const index = Math.min(MAX_BOX, Math.max(1, box)) - 1
  return LEITNER_DAYS[index] ?? 1
}

/** A pass only moves the card up when the review was due (or it is the first answer ever). */
export function isReviewable(s: Pick<MasteryState, 'box' | 'nextReviewAt'>, atMs: number): boolean {
  return s.box <= 0 || s.nextReviewAt === null || atMs >= s.nextReviewAt
}

export function boxAfterAnswer(box: number, correct: boolean, reviewable: boolean): number {
  if (!correct || box <= 0) return 1
  return reviewable ? Math.min(MAX_BOX, box + 1) : box
}

/** 04:00 local on the review day that lies `days` review-days after `fromMs`. */
export function dueAfterDays(fromMs: number, days: number, lt: LocalTime): number {
  const base = lt.dayStart(fromMs - ROLLOVER_MS)
  return lt.dayStart(base + days * DAY_MS + 12 * HOUR_MS) + ROLLOVER_MS
}

/** Review anchors before a deadline: 04:00 local three days and one day before its day. */
export function deadlineAnchors(deadlineMs: number, lt: LocalTime): [number, number] {
  const day = lt.dayStart(deadlineMs)
  const at = (d: number) => lt.dayStart(day - d * DAY_MS + 12 * HOUR_MS) + ROLLOVER_MS
  return [at(3), at(1)]
}

/** Moves a planned review to the earliest deadline anchor (T−3 d, T−1 d) it would overshoot. */
export function pullInForDeadlines(
  plannedMs: number,
  nowMs: number,
  deadlinesMs: readonly number[],
  lt: LocalTime,
): number {
  let result = plannedMs
  for (const deadline of deadlinesMs) {
    if (deadline <= nowMs) continue
    for (const anchor of deadlineAnchors(deadline, lt)) {
      if (anchor < nowMs + MIN_REVIEW_LEAD_MS) continue
      if (anchor < result) result = anchor
      break
    }
  }
  return result
}

/**
 * Deadline ramp-up for concepts already in the review cycle: with a deadline ≤ 3 days ahead, a
 * review planned after its T−1 d anchor moves to that anchor (or to now once it has passed, but
 * never within 12 h of the last time the concept was seen). Returns null when nothing changes.
 */
export function rampReviewAt(
  s: Pick<MasteryState, 'box' | 'nextReviewAt'>,
  lastSeenMs: number | null,
  nowMs: number,
  deadlinesMs: readonly number[],
  lt: LocalTime,
): number | null {
  if (s.box <= 0 || s.nextReviewAt === null) return null
  let best: number | null = null
  for (const deadline of deadlinesMs) {
    if (deadline <= nowMs || deadline - nowMs > RAMP_WINDOW_MS) continue
    const earliest = Math.max(nowMs, (lastSeenMs ?? Number.NEGATIVE_INFINITY) + RAMP_REST_MS)
    const target = Math.max(deadlineAnchors(deadline, lt)[1], earliest)
    if (target >= deadline || s.nextReviewAt <= target) continue
    if (best === null || target < best) best = target
  }
  return best
}

export interface AnswerEvent {
  correct: boolean
  difficulty: number
  atMs: number
  deadlinesMs: readonly number[]
}

export function applyAnswerToState(s: MasteryState, e: AnswerEvent, lt: LocalTime): MasteryState {
  const reviewable = isReviewable(s, e.atMs)
  const box = boxAfterAnswer(s.box, e.correct, reviewable)
  let nextReviewAt = s.nextReviewAt
  if (!e.correct || reviewable) {
    nextReviewAt = dueAfterDays(e.atMs, intervalDays(box), lt)
  }
  if (nextReviewAt !== null) {
    nextReviewAt = pullInForDeadlines(nextReviewAt, e.atMs, e.deadlinesMs, lt)
  }
  return {
    mastery: masteryAfterAnswer(s.mastery, e.correct, e.difficulty),
    box,
    nextReviewAt,
    struggling: !e.correct, // a miss raises the flag; a pass clears it
    struggleCount: s.struggleCount + (e.correct ? 0 : 1),
  }
}

export function applyEncounterToState(
  s: MasteryState,
  understanding: UnderstandingStatus,
): MasteryState {
  const struggled = understanding === 'struggling'
  return {
    ...s,
    mastery: masteryAfterEncounter(s.mastery, understanding),
    struggling: s.struggling || struggled,
    struggleCount: s.struggleCount + (struggled ? 1 : 0),
  }
}
