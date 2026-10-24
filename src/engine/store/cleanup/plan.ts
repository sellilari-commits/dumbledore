/**
 * Memory cleanup plan: which concepts of each subject are the same concept (equal conceptKey) and
 * fold into which survivor, and — when asked — which subject merges into which. Pure reads over
 * `Repos`, so a dry run and the real run compute the very same plan; `formatPlan` prints it.
 *
 * Order (the apply step follows it): duplicates inside every subject fold into the oldest member
 * first, then the subject merge folds each remaining concept into the target's equal concept or
 * moves it over.
 */
import type { Concept, Id, MasteryStatus } from '@shared/domain'
import type { Repos } from '../../contracts'
import { foldConcepts, survivorParent } from '../concept-fold'
import { conceptKey } from '../concept-key'

export interface FoldedConcept {
  id: Id
  name: string
}

/** One survivor and the concepts that fold into it, in fold order. */
export interface ConceptGroup {
  subjectId: Id
  subjectName: string
  intoId: Id
  intoName: string
  members: FoldedConcept[]
  /** The survivor once everything is folded in. */
  result: Concept
}

export interface SubjectMergePlan {
  fromId: Id
  fromName: string
  intoId: Id
  intoName: string
  /** Concepts of `from` that fold into an equal concept of `into`. */
  folds: ConceptGroup[]
  /** Concepts of `from` that move over unchanged. */
  moves: FoldedConcept[]
  /** What else moves along. */
  counts: { encounters: number; roadmaps: number; quizzes: number; assignments: number }
}

export interface CleanupPlan {
  groups: ConceptGroup[]
  merge: SubjectMergePlan | null
}

export interface MergeRequest {
  from: string
  into: string
}

const fold = (into: Concept, from: Concept): Concept => ({
  ...foldConcepts(into, from),
  parentId: survivorParent(into, from),
})

function findSubject(repos: Repos, name: string) {
  const subject = repos.subjects.findByName(name)
  if (subject) return subject
  const known = repos.subjects
    .list()
    .map((s) => `"${s.name}"`)
    .join(', ')
  throw new Error(`no subject called "${name}" (subjects: ${known || 'none'})`)
}

export function planCleanup(repos: Repos, request?: MergeRequest | null): CleanupPlan {
  const groups: ConceptGroup[] = []
  const after = new Map<Id, Concept[]>() // subject → concepts once its duplicates are folded
  for (const subject of repos.subjects.list()) {
    const byKey = new Map<string, Concept[]>()
    for (const c of repos.concepts.listBySubject(subject.id)) {
      const key = conceptKey(c.name)
      byKey.set(key, [...(byKey.get(key) ?? []), c])
    }
    const survivors: Concept[] = []
    for (const [first, ...rest] of byKey.values()) {
      if (!first) continue
      const result = rest.reduce(fold, first)
      survivors.push(result)
      if (rest.length === 0) continue
      groups.push({
        subjectId: subject.id,
        subjectName: subject.name,
        intoId: first.id,
        intoName: first.name,
        members: rest.map((c) => ({ id: c.id, name: c.name })),
        result,
      })
    }
    after.set(subject.id, survivors)
  }
  return { groups, merge: request ? planMerge(repos, request, after) : null }
}

function planMerge(
  repos: Repos,
  request: MergeRequest,
  after: Map<Id, Concept[]>,
): SubjectMergePlan {
  const from = findSubject(repos, request.from)
  const into = findSubject(repos, request.into)
  if (from.id === into.id)
    throw new Error(`"${request.from}" and "${request.into}" are one subject`)
  const target = [...(after.get(into.id) ?? [])]
  const folds = new Map<Id, ConceptGroup>()
  const moves: FoldedConcept[] = []
  for (const c of after.get(from.id) ?? []) {
    const key = conceptKey(c.name)
    const index = target.findIndex((x) => conceptKey(x.name) === key)
    const twin = target[index]
    if (!twin) {
      moves.push({ id: c.id, name: c.name })
      target.push({ ...c, subjectId: into.id })
      continue
    }
    const group = folds.get(twin.id) ?? {
      subjectId: into.id,
      subjectName: into.name,
      intoId: twin.id,
      intoName: twin.name,
      members: [],
      result: twin,
    }
    group.members.push({ id: c.id, name: c.name })
    group.result = fold(group.result, c)
    target[index] = group.result
    folds.set(twin.id, group)
  }
  return {
    fromId: from.id,
    fromName: from.name,
    intoId: into.id,
    intoName: into.name,
    folds: [...folds.values()],
    moves,
    counts: {
      encounters: repos.encounters.list({ subjectId: from.id }).length,
      roadmaps: repos.roadmaps.listBySubject(from.id).length,
      quizzes: repos.quizzes.list({ subjectId: from.id }).length,
      assignments: repos.assignments.list({ subjectId: from.id }).length,
    },
  }
}

export const isEmptyPlan = (plan: CleanupPlan): boolean =>
  plan.groups.length === 0 && plan.merge === null

const STATUS: Record<MasteryStatus, string> = {
  new: 'new',
  learning: 'learning',
  struggling: 'struggling',
  mastered: 'mastered',
}

function stats(c: Concept): string {
  const parts = [STATUS[c.status], `mastery ${c.mastery.toFixed(2)}`, `box ${c.box}`]
  if (c.struggleCount > 0)
    parts.push(`${c.struggleCount} struggle${c.struggleCount > 1 ? 's' : ''}`)
  if (c.nextReviewAt) parts.push(`review ${c.nextReviewAt.slice(0, 10)}`)
  return parts.join(' · ')
}

function groupLines(g: ConceptGroup, indent: string, verb = ''): string[] {
  const from = g.members.map((m) => `"${m.name}"`).join(', ')
  const rename = g.result.name === g.intoName ? '' : ` (renamed "${g.result.name}")`
  return [
    `${indent}${verb}${from} → "${g.intoName}"${rename}`,
    `${indent}${' '.repeat(verb.length)}  = ${stats(g.result)}`,
  ]
}

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

export function formatPlan(plan: CleanupPlan): string[] {
  const lines: string[] = []
  const bySubject = new Map<string, ConceptGroup[]>()
  for (const g of plan.groups)
    bySubject.set(g.subjectName, [...(bySubject.get(g.subjectName) ?? []), g])
  const folded = plan.groups.reduce((n, g) => n + g.members.length, 0)
  lines.push(
    `Duplicate concepts inside subjects: ${count(plan.groups.length, 'group', 'groups')}, ${count(folded, 'concept folds', 'concepts fold')} away`,
  )
  for (const [subject, groups] of bySubject) {
    lines.push(`  ${subject}`)
    for (const g of groups) lines.push(...groupLines(g, '    '))
  }
  const m = plan.merge
  if (!m) {
    lines.push('Subject merge: none requested')
    return lines
  }
  lines.push(`Subject merge: "${m.fromName}" → "${m.intoName}" (then "${m.fromName}" is deleted)`)
  for (const g of m.folds) lines.push(...groupLines(g, '    ', 'fold '))
  for (const c of m.moves) lines.push(`    move "${c.name}"`)
  const { encounters, roadmaps, quizzes, assignments } = m.counts
  const along = [
    count(encounters, 'encounter', 'encounters'),
    count(roadmaps, 'roadmap', 'roadmaps'),
    count(quizzes, 'quiz', 'quizzes'),
    count(assignments, 'assignment', 'assignments'),
  ]
  lines.push(`    also moves ${along.join(', ')}`)
  return lines
}
