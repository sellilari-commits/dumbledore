/**
 * Small helpers shared by the exam pages: icons per quiz kind, subject labels, time estimates,
 * score text and score → bar colour.
 */

import { scoreColor } from '@renderer/lib/status'
import type { QuizKind, SubjectSummary } from '@shared/domain'

export const KIND_ICON: Record<QuizKind, string> = {
  exam: '📝',
  review: '🔁',
  checkpoint: '🎯',
  placement: '🧭',
}

/** About 0.8 minutes per question, never less than a minute. */
export function minutesFor(questions: number): number {
  return Math.max(1, Math.round(questions * 0.8))
}

export function subjectsFor(
  ids: readonly string[],
  subjects: readonly SubjectSummary[] | undefined,
): SubjectSummary[] {
  if (!subjects) return []
  return ids.flatMap((id) => subjects.find((s) => s.id === id) ?? [])
}

/** "🧪 Organic Chemistry" or "🧪 Organic Chemistry + 📐 Linear Algebra". */
export function subjectLine(list: readonly SubjectSummary[]): string {
  return list.map((s) => `${s.emoji} ${s.name}`).join(' + ')
}

/** "Organic Chemistry and Linear Algebra" for sentences. */
export function subjectNames(list: readonly SubjectSummary[]): string {
  const names = list.map((s) => s.name)
  if (names.length <= 1) return names[0] ?? 'your subjects'
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}

/**
 * Title without a trailing " · <subject names>" when a Subjects column already shows them:
 * "Weak-spots exam · Organic Chemistry" → "Weak-spots exam".
 */
export function shortTitle(title: string, list: readonly SubjectSummary[]): string {
  const cut = title.lastIndexOf(' · ')
  if (cut <= 0 || list.length === 0) return title
  const suffix = title.slice(cut + 3)
  const names = list.map((s) => s.name)
  return suffix === names.join(' + ') || suffix === names.join(', ') ? title.slice(0, cut) : title
}

/** "7/10 · 70%" from a 0–1 score and a question count. */
export function scoreText(score: number, total: number): string {
  return `${Math.round(score * total)}/${total} · ${Math.round(score * 100)}%`
}

export type BarColor = 'green' | 'yellow' | 'red' | 'gray'

export function barColor(score: number | null): BarColor {
  const c = scoreColor(score)
  return c === 'green' || c === 'yellow' || c === 'red' ? c : 'gray'
}
