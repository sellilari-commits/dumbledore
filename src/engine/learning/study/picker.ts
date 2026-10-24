/**
 * The study picker (F2 step 3, PLAN R31): active and suggested subjects ranked by focus, recent
 * encounters, struggling concepts and due reviews, each with up to 3 open study questions.
 */
import type { Concept, Id, Subject, SubjectSummary } from '@shared/domain'
import type { PickerData } from '@shared/state'
import type { Repos } from '../../contracts'

const DAY_MS = 86_400_000
const RECENCY_WINDOW_DAYS = 14
const RECENCY_HALF_LIFE_HOURS = 48
export const PICKER_QUESTIONS = 3

export function summarizeSubject(repos: Repos, subject: Subject, nowIso: string): SubjectSummary {
  const concepts = repos.concepts.listBySubject(subject.id)
  const roadmap = repos.roadmaps.getActive(subject.id)
  const weekAgo = new Date(Date.parse(nowIso) - 7 * DAY_MS).toISOString()
  const week = repos.encounters.list({ subjectId: subject.id, sinceIso: weekAgo })
  const newest = repos.encounters.list({ subjectId: subject.id, limit: 1 })[0]
  const seen = [newest?.createdAt, ...concepts.map((c) => c.lastSeenAt)].filter(
    (d): d is string => typeof d === 'string',
  )
  const done =
    roadmap?.items.filter((i) => i.status === 'done' || i.status === 'skipped').length ?? 0
  return {
    ...subject,
    progress: roadmap && roadmap.items.length > 0 ? done / roadmap.items.length : 0,
    mastery:
      concepts.length > 0 ? concepts.reduce((n, c) => n + c.mastery, 0) / concepts.length : 0,
    dueReviews: dueCount(concepts, nowIso),
    openQuestions: repos.encounters.openQuestions(subject.id, 100).length,
    studyMinutesWeek: Math.round(week.reduce((n, e) => n + e.dwellSeconds, 0) / 60),
    lastStudiedAt: seen.sort().at(-1) ?? null,
  }
}

const dueCount = (concepts: Concept[], nowIso: string): number =>
  concepts.filter((c) => c.nextReviewAt !== null && c.nextReviewAt <= nowIso).length

export interface PickerScore {
  subjectId: Id
  score: number
}

/** Higher = earlier in the picker. Focus dominates; muted subjects sink to the bottom. */
export function scoreSubject(
  repos: Repos,
  subject: Subject,
  nowIso: string,
  focusSubjectId: Id | null,
): number {
  const now = Date.parse(nowIso)
  let score = 0
  if (subject.focus === 'focus' || subject.id === focusSubjectId) score += 1000
  if (subject.focus === 'muted') score -= 1000
  if (subject.status === 'suggested') score -= 0.5

  const since = new Date(now - RECENCY_WINDOW_DAYS * DAY_MS).toISOString()
  const recency = repos.encounters
    .list({ subjectId: subject.id, sinceIso: since, limit: 50 })
    .filter((e) => e.inboxState !== 'ignored')
    .reduce((sum, e) => {
      const hours = Math.max(0, now - Date.parse(e.createdAt)) / 3_600_000
      return sum + 0.5 ** (hours / RECENCY_HALF_LIFE_HOURS)
    }, 0)
  score += Math.min(10, recency) * 3

  const concepts = repos.concepts.listBySubject(subject.id)
  score += Math.min(5, concepts.filter((c) => c.status === 'struggling').length) * 4
  score += Math.min(10, dueCount(concepts, nowIso)) * 2
  return score
}

export function buildPicker(repos: Repos, nowIso: string): PickerData {
  const focusSubjectId = repos.settings.get().focusSubjectId
  const ranked = repos.subjects
    .list({ status: ['active', 'suggested'] })
    .map((subject) => ({
      summary: summarizeSubject(repos, subject, nowIso),
      score: scoreSubject(repos, subject, nowIso, focusSubjectId),
    }))
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.summary.lastStudiedAt ?? '').localeCompare(a.summary.lastStudiedAt ?? '') ||
        a.summary.name.localeCompare(b.summary.name),
    )
  return {
    subjects: ranked.map(({ summary }) => ({
      subject: summary,
      questions: repos.encounters.openQuestions(summary.id, PICKER_QUESTIONS),
      hasActiveRoadmap: repos.roadmaps.getActive(summary.id) !== null,
    })),
  }
}
