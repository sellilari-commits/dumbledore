/**
 * Applies a cleanup plan (plan.ts) to the SQLite store in one transaction: it re-plans inside the
 * transaction and refuses when anything differs from the plan that was shown, folds every
 * duplicate group, merges the subject, then checks that every survivor came out exactly as
 * planned and that no duplicates are left. Any error rolls everything back.
 */
import type { Concept, Id } from '@shared/domain'
import type { SqliteRepos } from '../sqlite-repos'
import { type CleanupPlan, type MergeRequest, planCleanup } from './plan'

const FIELDS: (keyof Concept)[] = [
  'id',
  'subjectId',
  'parentId',
  'name',
  'summary',
  'mastery',
  'box',
  'nextReviewAt',
  'status',
  'struggleCount',
  'lastSeenAt',
]

/** Survivors as the plan predicts them after both steps (concept id → final state). */
function expectedSurvivors(plan: CleanupPlan): Map<Id, Concept> {
  const expected = new Map<Id, Concept>()
  for (const g of plan.groups) expected.set(g.intoId, g.result)
  const merge = plan.merge
  if (!merge) return expected
  for (const c of merge.moves) {
    const survivor = expected.get(c.id)
    if (survivor) expected.set(c.id, { ...survivor, subjectId: merge.intoId })
  }
  for (const g of merge.folds) {
    for (const m of g.members) expected.delete(m.id)
    expected.set(g.intoId, g.result)
  }
  return expected
}

function checkOutcome(repos: SqliteRepos, plan: CleanupPlan): void {
  for (const [id, want] of expectedSurvivors(plan)) {
    const got = repos.concepts.get(id)
    const diff = got ? FIELDS.filter((f) => got[f] !== want[f]) : ['missing']
    if (diff.length > 0) throw new Error(`concept ${id} differs from the plan (${diff.join(', ')})`)
  }
  for (const g of [...plan.groups, ...(plan.merge?.folds ?? [])])
    for (const m of g.members)
      if (repos.concepts.get(m.id)) throw new Error(`concept ${m.id} was not folded`)
  if (plan.merge && repos.subjects.get(plan.merge.fromId))
    throw new Error(`subject "${plan.merge.fromName}" was not merged`)
  const left = planCleanup(repos).groups
  if (left.length > 0) throw new Error(`${left.length} duplicate group(s) remain`)
}

export function applyCleanup(
  repos: SqliteRepos,
  shown: CleanupPlan,
  request: MergeRequest | null,
): CleanupPlan {
  return repos.transaction(() => {
    const plan = planCleanup(repos, request)
    if (JSON.stringify(plan) !== JSON.stringify(shown))
      throw new Error('the data changed since the plan was printed; nothing was applied')
    for (const g of plan.groups)
      for (const m of g.members) repos.relink.mergeConcepts(m.id, g.intoId)
    if (plan.merge) repos.subjects.merge(plan.merge.fromId, plan.merge.intoId)
    checkOutcome(repos, plan)
    return plan
  })
}
