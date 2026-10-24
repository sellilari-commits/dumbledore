/**
 * The study order for a subject (docs/NOTES.md §6), computed in code so the roadmap follows it:
 * prerequisites first (topological order over the concept edges), the tree's own order as the
 * tie-break, mastered concepts skipped (they still count as done prerequisites), pure topic
 * containers left out. The first concept of the order is the first one the student is ready for.
 */
import type { Concept, ConceptEdge } from '@shared/domain'

/** Mastery from which a concept counts as known and is left out of the order. */
export const MASTERED_AT = 0.85

export const isMastered = (c: Pick<Concept, 'status' | 'mastery'>): boolean =>
  c.status === 'mastered' || c.mastery >= MASTERED_AT

/** Concepts in tree order (each parent before its children, siblings in creation order). */
export function treeOrder(concepts: readonly Concept[]): Concept[] {
  const ids = new Set(concepts.map((c) => c.id))
  const children = new Map<string | null, Concept[]>()
  for (const c of concepts) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), c])
  }
  const out: Concept[] = []
  const seen = new Set<string>()
  const walk = (parent: string | null) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(null)
  for (const c of concepts) if (!seen.has(c.id)) out.push(c) // parent loops: never lost
  return out
}

export interface StudyOrderInput {
  concepts: readonly Concept[]
  edges: readonly Pick<ConceptEdge, 'fromId' | 'toId'>[]
  /** Active notes per concept id; a concept with children and no notes is a topic container. */
  noteCounts?: ReadonlyMap<string, number>
  /** Concept ids to leave out entirely (e.g. the student said "not this"). */
  exclude?: ReadonlySet<string>
}

/** Not-yet-mastered concepts in the order to teach them; the first is the place to start. */
export function studyOrder(input: StudyOrderInput): Concept[] {
  const tree = treeOrder(input.concepts)
  const rank = new Map(tree.map((c, i) => [c.id, i]))
  const hasChildren = new Set(input.concepts.flatMap((c) => (c.parentId ? [c.parentId] : [])))
  const counts = input.noteCounts
  const teachable = (c: Concept) =>
    !isMastered(c) &&
    !input.exclude?.has(c.id) &&
    !(hasChildren.has(c.id) && counts !== undefined && (counts.get(c.id) ?? 0) === 0)

  // Kahn's algorithm, always taking the ready concept that comes first in the tree.
  const prereqs = new Map<string, Set<string>>()
  const next = new Map<string, string[]>()
  for (const e of input.edges) {
    if (!rank.has(e.fromId) || !rank.has(e.toId) || e.fromId === e.toId) continue
    prereqs.set(e.toId, new Set([...(prereqs.get(e.toId) ?? []), e.fromId]))
    next.set(e.fromId, [...(next.get(e.fromId) ?? []), e.toId])
  }
  const waiting = new Map(tree.map((c) => [c.id, prereqs.get(c.id)?.size ?? 0]))
  const ready = tree.filter((c) => (waiting.get(c.id) ?? 0) === 0)
  const sorted: Concept[] = []
  const done = new Set<string>()
  while (ready.length > 0) {
    ready.sort((a, b) => (rank.get(a.id) ?? 0) - (rank.get(b.id) ?? 0))
    const c = ready.shift() as Concept
    if (done.has(c.id)) continue
    done.add(c.id)
    sorted.push(c)
    for (const id of next.get(c.id) ?? []) {
      const left = (waiting.get(id) ?? 1) - 1
      waiting.set(id, left)
      const target = tree[rank.get(id) ?? -1]
      if (left === 0 && target) ready.push(target)
    }
  }
  for (const c of tree) if (!done.has(c.id)) sorted.push(c) // a cycle: never drop a concept
  return sorted.filter(teachable)
}
