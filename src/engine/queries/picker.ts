/**
 * The study picker (PLAN §5.3 F2): active subjects ranked by focus, recent activity, struggling
 * concepts and due reviews, each with up to 3 open questions.
 */
import type { SubjectSummary } from '@shared/domain'
import type { PickerData } from '@shared/state'
import type { Repos } from '../contracts'
import { summarizeSubject } from './summary'
import { DAY_MS } from './time'

/** Ranking weights: an explicit focus dominates; the rest are capped so no factor runs away. */
export const PICKER_WEIGHTS = {
  focus: 100,
  muted: -100,
  recency: 10, // × e^(−days since last studied / 3)
  struggling: 4, // per struggling concept, up to 3
  due: 2, // per due review, up to 5
} as const

export function pickerScore(
  summary: SubjectSummary,
  struggling: number,
  focusSubjectId: string | null,
  nowMs: number,
): number {
  const w = PICKER_WEIGHTS
  let score = 0
  if (summary.focus === 'focus' || summary.id === focusSubjectId) score += w.focus
  if (summary.focus === 'muted') score += w.muted
  if (summary.lastStudiedAt) {
    const days = Math.max(0, nowMs - Date.parse(summary.lastStudiedAt)) / DAY_MS
    score += w.recency * Math.exp(-days / 3)
  }
  score += w.struggling * Math.min(struggling, 3)
  score += w.due * Math.min(summary.dueReviews, 5)
  return score
}

export function buildPicker(repos: Repos, nowMs: number): PickerData {
  const { focusSubjectId } = repos.settings.get()
  const ranked = repos.subjects
    .list({ status: ['active'] })
    .map((subject) => {
      const summary = summarizeSubject(repos, subject, nowMs)
      const struggling = repos.concepts
        .listBySubject(subject.id)
        .filter((c) => c.status === 'struggling').length
      return { summary, score: pickerScore(summary, struggling, focusSubjectId, nowMs) }
    })
    .sort(
      (a, b) =>
        b.score - a.score ||
        (b.summary.lastStudiedAt ?? '').localeCompare(a.summary.lastStudiedAt ?? '') ||
        a.summary.name.localeCompare(b.summary.name),
    )
  return {
    subjects: ranked.map(({ summary }) => ({
      subject: summary,
      questions: repos.encounters.openQuestions(summary.id, 3),
      hasActiveRoadmap: repos.roadmaps.getActive(summary.id) !== null,
    })),
  }
}
