/**
 * Folding one concept into another that means the same thing (same conceptKey): the pure part,
 * shared by the SQLite repos and the in-memory twin. The survivor keeps its id, subject, parent
 * and place in the list; the numbers combine so nothing learned is lost: the higher mastery and
 * Leitner box, struggle counts summed, the latest last-seen, the sooner next review, struggling
 * if either was. The survivor keeps its name unless the other one is clearly nicer.
 */
import type { CoachAction, Concept, Id, MasteryStatus } from '@shared/domain'
import { isNicerName } from './concept-key'

const RANK: Record<MasteryStatus, number> = { new: 0, learning: 1, mastered: 2, struggling: 3 }

const time = (iso: string): number => {
  const ms = Date.parse(iso)
  return Number.isNaN(ms) ? Number.NEGATIVE_INFINITY : ms
}

function pick(a: string | null, b: string | null, prefer: 'earlier' | 'later'): string | null {
  if (a === null || b === null) return a ?? b
  const aFirst = time(a) < time(b) || (time(a) === time(b) && a <= b)
  return (prefer === 'earlier') === aFirst ? a : b
}

/** The survivor `into` after absorbing `from` (ids, subject and parent stay `into`'s). */
export function foldConcepts(into: Concept, from: Concept): Concept {
  return {
    ...into,
    name: isNicerName(into.name, from.name) ? from.name.trim() : into.name,
    summary: into.summary || from.summary,
    mastery: Math.max(into.mastery, from.mastery),
    box: Math.max(into.box, from.box),
    nextReviewAt: pick(into.nextReviewAt, from.nextReviewAt, 'earlier'),
    status: RANK[from.status] > RANK[into.status] ? from.status : into.status,
    struggleCount: into.struggleCount + from.struggleCount,
    lastSeenAt: pick(into.lastSeenAt, from.lastSeenAt, 'later'),
  }
}

/** Parent of the survivor once `from` is gone: a survivor hanging from `from` takes its parent. */
export function survivorParent(into: Concept, from: Concept): Id | null {
  if (into.parentId !== from.id) return into.parentId
  return from.parentId === into.id ? null : from.parentId
}

/** Re-points review actions at the survivor; returns null when nothing changed. */
export function relinkAction(action: CoachAction, fromId: Id, intoId: Id): CoachAction | null {
  if (action.type !== 'start_review' || !action.conceptIds.includes(fromId)) return null
  const conceptIds = [...new Set(action.conceptIds.map((id) => (id === fromId ? intoId : id)))]
  return { ...action, conceptIds }
}
