import { DAY_MS, fixedOffsetLocalTime, HOUR_MS } from '@engine/scheduler/local-time'
import { describe, expect, it } from 'vitest'
import {
  applyAnswerToState,
  applyEncounterToState,
  boxAfterAnswer,
  deadlineAnchors,
  deriveStatus,
  difficultyFactor,
  dueAfterDays,
  intervalDays,
  type MasteryState,
  masteryAfterAnswer,
  masteryAfterEncounter,
  pullInForDeadlines,
  rampReviewAt,
} from './mastery-math'

const lt = fixedOffsetLocalTime(0)
const at = (iso: string) => Date.parse(iso)
const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString())
const fresh = (): MasteryState => ({
  mastery: 0,
  box: 0,
  nextReviewAt: null,
  struggling: false,
  struggleCount: 0,
})

describe('mastery maths', () => {
  it('scales gains by difficulty', () => {
    expect(difficultyFactor(1)).toBe(0.75)
    expect(difficultyFactor(2)).toBe(1)
    expect(difficultyFactor(3)).toBe(1.25)
    expect(difficultyFactor(9)).toBe(1.25)
    expect(difficultyFactor(Number.NaN)).toBe(1)
  })

  it('applies correct and wrong answers', () => {
    expect(masteryAfterAnswer(0, true, 2)).toBeCloseTo(0.3)
    expect(masteryAfterAnswer(0.5, true, 2)).toBeCloseTo(0.65)
    expect(masteryAfterAnswer(0, true, 3)).toBeCloseTo(0.375)
    expect(masteryAfterAnswer(0.5, false, 2)).toBeCloseTo(0.3)
    expect(masteryAfterAnswer(0.99, true, 3)).toBeLessThanOrEqual(1)
  })

  it('lets reading raise mastery only a little', () => {
    expect(masteryAfterEncounter(0.5, 'struggling')).toBeCloseTo(0.45)
    expect(masteryAfterEncounter(0.1, 'understood')).toBeCloseTo(0.15)
    expect(masteryAfterEncounter(0, 'unknown')).toBeCloseTo(0.02)
    expect(masteryAfterEncounter(0.4, 'unclear')).toBe(0.4)
    expect(masteryAfterEncounter(0.58, 'understood')).toBeCloseTo(0.6) // ceiling
    expect(masteryAfterEncounter(0.7, 'understood')).toBe(0.7)
    let m = 0
    for (let i = 0; i < 100; i++) m = masteryAfterEncounter(m, 'understood')
    expect(m).toBeLessThanOrEqual(0.6)
  })

  it('derives status from thresholds, flag and spaced reviews', () => {
    expect(deriveStatus({ mastery: 0.1, box: 0, struggling: false })).toBe('new')
    expect(deriveStatus({ mastery: 0.2, box: 1, struggling: false })).toBe('learning')
    expect(deriveStatus({ mastery: 0.69, box: 2, struggling: false })).toBe('learning')
    expect(deriveStatus({ mastery: 0.9, box: 2, struggling: false })).toBe('learning')
    expect(deriveStatus({ mastery: 0.9, box: 3, struggling: false })).toBe('mastered')
    expect(deriveStatus({ mastery: 0.9, box: 5, struggling: true })).toBe('struggling')
  })

  it('walks the Leitner boxes', () => {
    expect([1, 2, 3, 4, 5].map(intervalDays)).toEqual([1, 3, 7, 16, 35])
    expect(boxAfterAnswer(0, true, true)).toBe(1)
    expect(boxAfterAnswer(0, false, true)).toBe(1)
    expect(boxAfterAnswer(2, true, true)).toBe(3)
    expect(boxAfterAnswer(5, true, true)).toBe(5)
    expect(boxAfterAnswer(4, false, true)).toBe(1)
    expect(boxAfterAnswer(3, true, false)).toBe(3)
  })

  it('makes reviews due at 04:00 local on the review day', () => {
    const t = at('2026-10-24T09:00:00Z')
    expect(iso(dueAfterDays(t, 1, lt))).toBe('2026-10-25T04:00:00.000Z')
    expect(iso(dueAfterDays(t, 3, lt))).toBe('2026-10-27T04:00:00.000Z')
    expect(iso(dueAfterDays(t, 35, lt))).toBe('2026-11-28T04:00:00.000Z')
    // In a UTC+3 zone the same instant is 12:00 local; due 04:00 local = 01:00Z next day.
    expect(iso(dueAfterDays(t, 1, fixedOffsetLocalTime(180)))).toBe('2026-10-25T01:00:00.000Z')
  })

  it('schedules 1/3/7/16/35 days for passes on due reviews', () => {
    let s = fresh()
    let now = at('2026-10-24T09:00:00Z')
    const gaps: number[] = []
    for (let i = 0; i < 5; i++) {
      s = applyAnswerToState(s, { correct: true, difficulty: 2, atMs: now, deadlinesMs: [] }, lt)
      const next = s.nextReviewAt ?? 0
      gaps.push(Math.round((lt.dayStart(next) - lt.dayStart(now)) / DAY_MS))
      now = next + 5 * HOUR_MS // answer at 09:00 on the due day
    }
    expect(gaps).toEqual([1, 3, 7, 16, 35])
    expect(s.box).toBe(5)
  })

  it('needs two passed spaced reviews to be mastered', () => {
    let s: MasteryState = { ...fresh(), mastery: 0.9 }
    let now = at('2026-10-24T09:00:00Z')
    s = applyAnswerToState(s, { correct: true, difficulty: 2, atMs: now, deadlinesMs: [] }, lt)
    expect(deriveStatus(s)).toBe('learning') // box 1: first pass only
    now = (s.nextReviewAt ?? 0) + HOUR_MS
    s = applyAnswerToState(s, { correct: true, difficulty: 2, atMs: now, deadlinesMs: [] }, lt)
    expect(deriveStatus(s)).toBe('learning') // box 2: one spaced review
    now = (s.nextReviewAt ?? 0) + HOUR_MS
    s = applyAnswerToState(s, { correct: true, difficulty: 2, atMs: now, deadlinesMs: [] }, lt)
    expect(s.box).toBe(3)
    expect(deriveStatus(s)).toBe('mastered')
  })

  it('does not advance the box for a pass before the review is due', () => {
    const now = at('2026-10-24T09:00:00Z')
    let s = applyAnswerToState(
      fresh(),
      { correct: true, difficulty: 2, atMs: now, deadlinesMs: [] },
      lt,
    )
    const due = s.nextReviewAt
    s = applyAnswerToState(
      s,
      { correct: true, difficulty: 2, atMs: now + 60_000, deadlinesMs: [] },
      lt,
    )
    expect(s.box).toBe(1)
    expect(s.nextReviewAt).toBe(due)
    expect(s.mastery).toBeCloseTo(0.51)
  })

  it('sends a miss back to box 1, flags it, and clears the flag on the next pass', () => {
    const now = at('2026-10-24T09:00:00Z')
    let s: MasteryState = {
      mastery: 0.8,
      box: 4,
      nextReviewAt: now - HOUR_MS,
      struggling: false,
      struggleCount: 0,
    }
    s = applyAnswerToState(s, { correct: false, difficulty: 2, atMs: now, deadlinesMs: [] }, lt)
    expect(s.box).toBe(1)
    expect(s.mastery).toBeCloseTo(0.48)
    expect(s.struggleCount).toBe(1)
    expect(deriveStatus(s)).toBe('struggling')
    expect(iso(s.nextReviewAt)).toBe('2026-10-25T04:00:00.000Z')
    s = applyAnswerToState(
      s,
      { correct: true, difficulty: 2, atMs: now + HOUR_MS, deadlinesMs: [] },
      lt,
    )
    expect(deriveStatus(s)).toBe('learning')
    expect(s.box).toBe(1)
  })

  it('flags struggling encounters without touching the schedule', () => {
    const s = applyEncounterToState(
      { ...fresh(), mastery: 0.5, box: 2, nextReviewAt: 123 },
      'struggling',
    )
    expect(s.mastery).toBeCloseTo(0.45)
    expect(s.struggling).toBe(true)
    expect(s.struggleCount).toBe(1)
    expect(s.box).toBe(2)
    expect(s.nextReviewAt).toBe(123)
    expect(applyEncounterToState(s, 'understood').struggling).toBe(true)
  })
})

describe('deadline pull-in', () => {
  const deadline = at('2026-12-12T09:00:00Z')

  it('anchors reviews three days and one day before the deadline', () => {
    expect(deadlineAnchors(deadline, lt).map(iso)).toEqual([
      '2026-12-09T04:00:00.000Z',
      '2026-12-11T04:00:00.000Z',
    ])
  })

  it('pulls a long interval in to T−3 d', () => {
    const now = at('2026-12-02T09:00:00Z') // 10 days before
    const s: MasteryState = {
      mastery: 0.7,
      box: 3,
      nextReviewAt: now - HOUR_MS,
      struggling: false,
      struggleCount: 0,
    }
    const next = applyAnswerToState(
      s,
      { correct: true, difficulty: 2, atMs: now, deadlinesMs: [deadline] },
      lt,
    )
    expect(next.box).toBe(4) // 16 days would land after the deadline
    expect(iso(next.nextReviewAt)).toBe('2026-12-09T04:00:00.000Z')
  })

  it('reviews no later than T−1 d when the deadline is within 3 days', () => {
    const now = at('2026-12-10T10:00:00Z')
    const s: MasteryState = {
      mastery: 0.6,
      box: 2,
      nextReviewAt: now - HOUR_MS,
      struggling: false,
      struggleCount: 0,
    }
    const next = applyAnswerToState(
      s,
      { correct: true, difficulty: 2, atMs: now, deadlinesMs: [deadline] },
      lt,
    )
    expect(iso(next.nextReviewAt)).toBe('2026-12-11T04:00:00.000Z')
    // A date-only deadline means the start of that day: T−1 d is still the 11th.
    expect(iso(pullInForDeadlines(now + 7 * DAY_MS, now, [at('2026-12-12T00:00:00Z')], lt))).toBe(
      '2026-12-11T04:00:00.000Z',
    )
  })

  it('keeps short intervals and skips anchors that are too close', () => {
    const now = at('2026-12-02T09:00:00Z')
    expect(pullInForDeadlines(now + DAY_MS, now, [deadline], lt)).toBe(now + DAY_MS)
    const late = at('2026-12-11T02:00:00Z') // T−1 anchor is 2 h away
    expect(pullInForDeadlines(late + 3 * DAY_MS, late, [deadline], lt)).toBe(late + 3 * DAY_MS)
    expect(pullInForDeadlines(now + 3 * DAY_MS, now, [now - DAY_MS], lt)).toBe(now + 3 * DAY_MS)
  })

  it('ramps up reviews before a near deadline', () => {
    const now = at('2026-12-10T09:00:00Z')
    const state = { box: 3, nextReviewAt: now + 10 * DAY_MS }
    expect(iso(rampReviewAt(state, null, now, [deadline], lt))).toBe('2026-12-11T04:00:00.000Z')
    // Too far away, nothing to do.
    expect(rampReviewAt(state, null, at('2026-12-01T09:00:00Z'), [deadline], lt)).toBeNull()
    // Already due before the anchor.
    expect(rampReviewAt({ box: 2, nextReviewAt: now }, null, now, [deadline], lt)).toBeNull()
    // Never quizzed: left to the deadline nudge.
    expect(rampReviewAt({ box: 0, nextReviewAt: null }, null, now, [deadline], lt)).toBeNull()
    // Anchor passed: due now, unless it was seen in the last 12 h.
    const eve = at('2026-12-11T20:00:00Z')
    expect(rampReviewAt(state, null, eve, [deadline], lt)).toBe(eve)
    expect(iso(rampReviewAt(state, eve - 2 * HOUR_MS, eve, [deadline], lt))).toBe(
      '2026-12-12T06:00:00.000Z',
    )
    const lateNight = at('2026-12-11T22:00:00Z') // +12 h rest would pass the deadline
    expect(rampReviewAt(state, lateNight, at('2026-12-12T00:00:00Z'), [deadline], lt)).toBeNull()
  })
})
