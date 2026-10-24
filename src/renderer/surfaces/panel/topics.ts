/**
 * What the mini panel shows: one subject and its topics. The focus subject wins; otherwise the
 * subject that most recently got new information (its newest encounter, concept or quiz).
 * Suggested subjects count only while there is no active one. Topics are the subject's
 * top-level concepts (the level right under the subject), most recently seen first.
 */
import type { Concept, MasteryStatus, SubjectSummary } from '@shared/domain'

/** The subjects the panel can show: the active ones, else the suggested ones. */
export function panelSubjects(subjects: readonly SubjectSummary[]): SubjectSummary[] {
  const active = subjects.filter((s) => s.status === 'active')
  return active.length > 0 ? active : subjects.filter((s) => s.status === 'suggested')
}

const freshness = (s: SubjectSummary): string => s.lastStudiedAt ?? s.updatedAt

export function pickSubject(
  subjects: readonly SubjectSummary[],
  focusId: string | null,
): SubjectSummary | null {
  const focus = focusId
    ? subjects.find((s) => s.id === focusId && s.status !== 'archived')
    : undefined
  if (focus) return focus
  let latest: SubjectSummary | null = null
  for (const s of panelSubjects(subjects)) {
    if (!latest || freshness(s) > freshness(latest)) latest = s
  }
  return latest
}

/** Top-level concepts (no parent, or a parent outside the list), newest first. */
export function topicsOf(concepts: readonly Concept[]): Concept[] {
  const ids = new Set(concepts.map((c) => c.id))
  return concepts
    .filter((c) => c.parentId === null || !ids.has(c.parentId))
    .sort(
      (a, b) =>
        (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name),
    )
}

export const STATUS_LABEL: Record<MasteryStatus, string> = {
  new: 'New',
  learning: 'Learning',
  struggling: 'Needs another look',
  mastered: 'Mastered',
}
