/**
 * Pure helpers for the subject page: the four views, the Status property, roadmap progress,
 * concept sorting (Concepts view) and grouping encounters by day (Seen view).
 */
import { daysUntil } from '@renderer/lib/format'
import { MASTERY, type StatusLabel } from '@renderer/lib/status'
import type { Concept, Encounter, MasteryStatus, Roadmap, SubjectSummary } from '@shared/domain'

export const VIEWS = ['roadmap', 'concepts', 'seen', 'exams'] as const
export type SubjectView = (typeof VIEWS)[number]

export function isView(value: string | undefined): value is SubjectView {
  return (VIEWS as readonly string[]).includes(value ?? '')
}

/** A concept is due when its next review is today or earlier. */
export function isDue(c: Concept, now = Date.now()): boolean {
  return c.nextReviewAt !== null && daysUntil(c.nextReviewAt, now) <= 0
}

/** Status property: suggested / archived as-is; active subjects by how learning is going. */
export function subjectStatus(s: SubjectSummary, concepts: readonly Concept[]): StatusLabel {
  if (s.status === 'suggested') return { label: 'Suggested', color: 'gray' }
  if (s.status === 'archived') return { label: 'Archived', color: 'default' }
  if (concepts.length === 0 || concepts.every((c) => c.status === 'new')) return MASTERY.new
  if (concepts.every((c) => c.status === 'mastered') || s.mastery >= 0.8) return MASTERY.mastered
  return MASTERY.learning
}

export interface RoadmapProgress {
  done: number
  total: number
  /** 1-based number of the step the student is on (total + 1 once finished). */
  step: number
}

export function roadmapProgress(r: Roadmap): RoadmapProgress {
  const done = r.items.filter((i) => i.status === 'done' || i.status === 'skipped').length
  const current = r.items.findIndex((i) => i.status === 'current')
  return { done, total: r.items.length, step: current < 0 ? done + 1 : current + 1 }
}

// ─── Concepts: sorting ──────────────────────────────────────────────────────────────────────

export type ConceptSortKey = 'name' | 'status' | 'mastery' | 'lastSeen' | 'nextReview'
export interface ConceptSort {
  key: ConceptSortKey
  dir: 'asc' | 'desc'
}

export const SORT_LABEL: Record<ConceptSortKey, string> = {
  name: 'Name',
  status: 'Status',
  mastery: 'Mastery',
  lastSeen: 'Last seen',
  nextReview: 'Next review',
}

/** Weakest first: the useful default for a student. */
export const DEFAULT_SORT: ConceptSort = { key: 'mastery', dir: 'asc' }

/** Direction a key starts with when picked: newest "last seen" first, everything else ascending. */
export const DEFAULT_DIR: Record<ConceptSortKey, ConceptSort['dir']> = {
  name: 'asc',
  status: 'asc',
  mastery: 'asc',
  lastSeen: 'desc',
  nextReview: 'asc',
}

/** Struggling → learning → new → mastered: what needs attention comes first. */
const STATUS_RANK: Record<MasteryStatus, number> = {
  struggling: 0,
  learning: 1,
  new: 2,
  mastered: 3,
}

function dateValue(iso: string | null): number | null {
  return iso === null ? null : new Date(iso).getTime()
}

function keyValue(c: Concept, key: ConceptSortKey): string | number | null {
  switch (key) {
    case 'name':
      return c.name.toLowerCase()
    case 'status':
      return STATUS_RANK[c.status]
    case 'mastery':
      return c.mastery
    case 'lastSeen':
      return dateValue(c.lastSeenAt)
    case 'nextReview':
      return dateValue(c.nextReviewAt)
  }
}

/** Sorted copy. Empty dates always sink to the bottom; ties fall back to the name. */
export function sortConcepts(list: readonly Concept[], sort: ConceptSort): Concept[] {
  const sign = sort.dir === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    const va = keyValue(a, sort.key)
    const vb = keyValue(b, sort.key)
    if (va === null || vb === null) {
      if (va !== vb) return va === null ? 1 : -1
    } else if (va !== vb) {
      return (va < vb ? -1 : 1) * sign
    }
    return a.name.localeCompare(b.name)
  })
}

// ─── Seen: grouping by day ──────────────────────────────────────────────────────────────────

export interface DayGroup {
  key: string
  label: string
  items: Encounter[]
}

function dayLabel(iso: string, now: number): string {
  const days = daysUntil(iso, now)
  if (days === 0) return 'Today'
  if (days === -1) return 'Yesterday'
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString('en-US', {
    weekday: days > -7 ? 'long' : undefined,
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

/** Newest day first; encounters keep their order (the read model sends newest first). */
export function groupByDay(list: readonly Encounter[], now = Date.now()): DayGroup[] {
  const groups: DayGroup[] = []
  for (const e of list) {
    const d = new Date(e.createdAt)
    const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    const last = groups.at(-1)
    if (last && last.key === key) last.items.push(e)
    else groups.push({ key, label: dayLabel(e.createdAt, now), items: [e] })
  }
  return groups
}

// ─── Concepts: tree depth ───────────────────────────────────────────────────────────────────

/** Depth of each concept in the topic tree (a missing parent or a cycle counts as a root). */
export function depthsOf(concepts: readonly Concept[]): Map<string, number> {
  const byId = new Map(concepts.map((c) => [c.id, c]))
  const depths = new Map<string, number>()
  const depth = (c: Concept, path: Set<string>): number => {
    const known = depths.get(c.id)
    if (known !== undefined) return known
    const parent = c.parentId ? byId.get(c.parentId) : undefined
    const d = parent && !path.has(parent.id) ? depth(parent, path.add(c.id)) + 1 : 0
    depths.set(c.id, d)
    return d
  }
  for (const c of concepts) depth(c, new Set())
  return depths
}
