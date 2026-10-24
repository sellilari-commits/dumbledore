/**
 * MasteryModel (engine/contracts.ts) on top of the repos: loads a concept, applies the pure maths
 * from ./mastery-math with the subject's deadlines (subject deadline + open assignments), and
 * saves mastery, Leitner box, next review, status, struggle count and last-seen time.
 *
 * Callers emit 'memory:changed'; this module only writes.
 */

import type { MasteryModel, Repos } from '@engine/contracts'
import { type LocalTime, parseDeadline, systemLocalTime } from '@engine/scheduler/local-time'
import type { Concept, Id, IsoDate, UnderstandingStatus } from '@shared/domain'
import {
  applyAnswerToState,
  applyEncounterToState,
  deriveStatus,
  type MasteryState,
  rampReviewAt,
} from './mastery-math'

export interface MasteryModelDeps {
  repos: Repos
  localTime?: LocalTime
}

export interface MasteryService extends MasteryModel {
  /** Upcoming deadline instants (epoch ms) that apply to a subject's concepts. */
  deadlinesFor(subjectId: Id): number[]
  /**
   * Deadline ramp-up: pulls reviews of concepts in subjects with a deadline ≤ 3 days ahead to
   * T−1 d. Idempotent; returns the ids of concepts that changed.
   */
  rampForDeadlines(nowMs: number): Id[]
}

const round4 = (x: number): number => Math.round(x * 10_000) / 10_000

function parseIso(iso: IsoDate): number {
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) throw new Error(`invalid timestamp "${iso}"`)
  return ms
}

export function toMasteryState(concept: Concept): MasteryState {
  const next = concept.nextReviewAt ? Date.parse(concept.nextReviewAt) : Number.NaN
  return {
    mastery: concept.mastery,
    box: concept.box,
    nextReviewAt: Number.isNaN(next) ? null : next,
    struggling: concept.status === 'struggling',
    struggleCount: concept.struggleCount,
  }
}

function laterIso(a: IsoDate | null, b: IsoDate): IsoDate {
  return a !== null && a > b ? a : b
}

export function createMasteryModel(deps: MasteryModelDeps): MasteryService {
  const { repos } = deps
  const lt = deps.localTime ?? systemLocalTime

  const mustGet = (id: Id): Concept => {
    const concept = repos.concepts.get(id)
    if (!concept) throw new Error(`concept ${id} not found`)
    return concept
  }

  const save = (concept: Concept, next: MasteryState, atIso: IsoDate): Concept =>
    repos.concepts.update(concept.id, {
      mastery: round4(next.mastery),
      box: next.box,
      nextReviewAt: next.nextReviewAt === null ? null : new Date(next.nextReviewAt).toISOString(),
      status: deriveStatus(next),
      struggleCount: next.struggleCount,
      lastSeenAt: laterIso(concept.lastSeenAt, atIso),
    })

  const deadlinesFor = (subjectId: Id): number[] => {
    const out: number[] = []
    const subjectDeadline = parseDeadline(repos.subjects.get(subjectId)?.deadline, lt)
    if (subjectDeadline !== null) out.push(subjectDeadline)
    for (const assignment of repos.assignments.list({ status: 'open', subjectId })) {
      const due = parseDeadline(assignment.dueAt, lt)
      if (due !== null) out.push(due)
    }
    return out
  }

  return {
    deadlinesFor,

    applyAnswer(conceptId, correct, difficulty, atIso) {
      const concept = mustGet(conceptId)
      const atMs = parseIso(atIso)
      const next = applyAnswerToState(
        toMasteryState(concept),
        { correct, difficulty, atMs, deadlinesMs: deadlinesFor(concept.subjectId) },
        lt,
      )
      return save(concept, next, atIso)
    },

    applyEncounter(conceptId: Id, understanding: UnderstandingStatus, atIso: IsoDate) {
      const concept = mustGet(conceptId)
      parseIso(atIso)
      return save(concept, applyEncounterToState(toMasteryState(concept), understanding), atIso)
    },

    rampForDeadlines(nowMs) {
      const changed: Id[] = []
      for (const subject of repos.subjects.list({ status: ['active'] })) {
        const deadlines = deadlinesFor(subject.id)
        if (deadlines.length === 0) continue
        for (const concept of repos.concepts.listBySubject(subject.id)) {
          const seen = concept.lastSeenAt ? Date.parse(concept.lastSeenAt) : Number.NaN
          const lastSeen = Number.isNaN(seen) ? null : seen
          const target = rampReviewAt(toMasteryState(concept), lastSeen, nowMs, deadlines, lt)
          if (target === null) continue
          repos.concepts.update(concept.id, { nextReviewAt: new Date(target).toISOString() })
          changed.push(concept.id)
        }
      }
      return changed
    },
  }
}
