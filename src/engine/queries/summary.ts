/**
 * Derived numbers for one subject (SubjectSummary): roadmap progress, mean mastery, due reviews,
 * open questions, study minutes in the last 7 days and when it was last studied.
 */
import type { Encounter, Roadmap, Subject, SubjectSummary } from '@shared/domain'
import type { Repos } from '../contracts'
import { DAY_MS, iso, latestIso } from './time'

/** The roadmap a subject shows: the active (or paused) one, else the most recent one. */
export function currentRoadmap(repos: Repos, subjectId: string): Roadmap | null {
  return repos.roadmaps.getActive(subjectId) ?? repos.roadmaps.listBySubject(subjectId)[0] ?? null
}

/** Share of items finished (done or skipped); a finished roadmap counts as 1. */
export function roadmapProgress(roadmap: Roadmap | null): number {
  if (!roadmap || roadmap.items.length === 0) return roadmap?.status === 'done' ? 1 : 0
  if (roadmap.status === 'done') return 1
  const finished = roadmap.items.filter((i) => i.status === 'done' || i.status === 'skipped').length
  return finished / roadmap.items.length
}

/** Index of the item to work on next (the current one, else the first to-do; length when done). */
export function currentItemIndex(roadmap: Roadmap): number {
  const current = roadmap.items.findIndex((i) => i.status === 'current')
  if (current >= 0) return current
  const todo = roadmap.items.findIndex((i) => i.status === 'todo')
  return todo >= 0 ? todo : roadmap.items.length
}

/** Whole minutes of dwell, counting each episode once (several items can come from one read). */
export function studyMinutes(encounters: readonly Encounter[]): number {
  const seen = new Set<string>()
  let seconds = 0
  for (const e of encounters) {
    if (e.inboxState === 'ignored') continue
    const key = e.episodeId ?? e.id
    if (seen.has(key)) continue
    seen.add(key)
    seconds += e.dwellSeconds
  }
  return Math.round(seconds / 60)
}

export function summarizeSubject(repos: Repos, subject: Subject, nowMs: number): SubjectSummary {
  const nowIso = iso(nowMs)
  const concepts = repos.concepts.listBySubject(subject.id)
  const week = repos.encounters.list({ subjectId: subject.id, sinceIso: iso(nowMs - 7 * DAY_MS) })
  const lastEncounter = repos.encounters
    .list({ subjectId: subject.id, limit: 20 })
    .find((e) => e.inboxState !== 'ignored')
  const lastQuiz = repos.quizzes
    .list({ subjectId: subject.id, limit: 10 })
    .map((q) => q.completedAt ?? q.answers.at(-1)?.answeredAt ?? null)
  const mastery = concepts.length
    ? concepts.reduce((sum, c) => sum + c.mastery, 0) / concepts.length
    : 0
  return {
    ...subject,
    progress: roadmapProgress(currentRoadmap(repos, subject.id)),
    mastery: Math.min(1, Math.max(0, mastery)),
    dueReviews: concepts.filter((c) => c.nextReviewAt !== null && c.nextReviewAt <= nowIso).length,
    openQuestions: repos.encounters.openQuestions(subject.id, 1000).length,
    studyMinutesWeek: studyMinutes(week),
    lastStudiedAt: latestIso([
      lastEncounter?.createdAt,
      ...concepts.map((c) => c.lastSeenAt),
      ...lastQuiz,
    ]),
  }
}
