/**
 * Pure operations on a Roadmap: where the session stands, advancing, recording a checkpoint
 * outcome with carry-over (§6.6), the misses the step writer should target, and the summary.
 * Nothing here touches storage; callers persist the returned copy.
 */
import type { CheckpointItem, Id, LearnItem, Probe, Roadmap, RoadmapItem } from '@shared/domain'
import { checkpointTitle, questionsFor } from './materialize'
import { norm, percent, plural, uniqueBy, uniqueNames } from './text'

export const isLearn = (item: RoadmapItem | null | undefined): item is LearnItem =>
  item?.kind === 'learn'
export const isCheckpoint = (item: RoadmapItem | null | undefined): item is CheckpointItem =>
  item?.kind === 'checkpoint'

/** Index of the item the student is on: the 'current' one, else the first 'todo'; -1 when none. */
export function currentIndex(roadmap: Roadmap): number {
  const current = roadmap.items.findIndex((i) => i.status === 'current')
  if (current >= 0) return current
  return roadmap.items.findIndex((i) => i.status === 'todo')
}

export function currentItem(roadmap: Roadmap): RoadmapItem | null {
  return roadmap.items[currentIndex(roadmap)] ?? null
}

/** The first item after `idx` that is still open. */
export function nextOpenItem(roadmap: Roadmap, idx: number): RoadmapItem | null {
  return (
    roadmap.items.find((i) => i.idx > idx && (i.status === 'todo' || i.status === 'current')) ??
    null
  )
}

/** A learn item counts as delivered once its prompt was handed to the shell. */
export const isDelivered = (item: LearnItem): boolean => item.promptSent !== null

export function checkpointOrdinal(roadmap: Roadmap, itemId: Id): number {
  return roadmap.items.filter(isCheckpoint).findIndex((i) => i.id === itemId) + 1
}

function cloneRoadmap(roadmap: Roadmap): Roadmap {
  return structuredClone(roadmap)
}

/**
 * Closes the item at `idx` (done or skipped) and makes the next open item current. When nothing
 * is left the roadmap becomes 'done'.
 */
export function closeItem(
  roadmap: Roadmap,
  idx: number,
  nowIso: string,
  status: 'done' | 'skipped' = 'done',
): Roadmap {
  const next = cloneRoadmap(roadmap)
  const item = next.items[idx]
  if (!item) return next
  item.status = status
  const following = next.items.find(
    (i) => i.idx > idx && (i.status === 'todo' || i.status === 'current'),
  )
  if (following) following.status = 'current'
  else if (!next.items.some((i) => i.status === 'todo' || i.status === 'current'))
    next.status = 'done'
  next.updatedAt = nowIso
  return next
}

/** Replaces one item (matched by id) in a copy of the roadmap. */
export function withItem(roadmap: Roadmap, item: RoadmapItem, nowIso: string): Roadmap {
  const next = cloneRoadmap(roadmap)
  next.items = next.items.map((i) => (i.id === item.id ? structuredClone(item) : i))
  next.updatedAt = nowIso
  return next
}

export interface CheckpointOutcome {
  quizId: Id
  score: number | null
  /** Concepts with at least one wrong answer. */
  missed: string[]
  /** Concepts answered fully correctly. */
  passed: string[]
  /** Diagnosed misconceptions (QuizResult.gaps). */
  gaps: Probe[]
}

/**
 * Records a finished checkpoint: score + done, carry updated (missed in, re-passed out), and the
 * next checkpoint widened to re-test everything still carried (+1 question each, max 5).
 */
export function applyCheckpointOutcome(
  roadmap: Roadmap,
  itemId: Id,
  outcome: CheckpointOutcome,
  nowIso: string,
): Roadmap {
  const idx = roadmap.items.findIndex((i) => i.id === itemId)
  const item = roadmap.items[idx]
  if (!isCheckpoint(item)) return roadmap
  const passed = new Set(outcome.passed.map(norm))
  const missed = new Set(outcome.missed.map(norm))
  const carry = uniqueNames([
    ...roadmap.carry.filter((c) => missed.has(norm(c)) || !passed.has(norm(c))),
    ...outcome.missed,
  ])
  let next = withItem(roadmap, { ...item, quizId: outcome.quizId, score: outcome.score }, nowIso)
  next.carry = carry
  const upcoming = next.items.find(
    (i): i is CheckpointItem =>
      isCheckpoint(i) && i.idx > idx && i.status !== 'done' && i.status !== 'skipped',
  )
  if (upcoming && carry.length > 0) {
    const carried = new Set(carry.map(norm))
    const nQuestions = questionsFor(upcoming.nQuestions, carry.length)
    next = withItem(
      next,
      {
        ...upcoming,
        covers: uniqueNames([...upcoming.covers, ...carry]),
        probes: uniqueBy(
          [...upcoming.probes, ...outcome.gaps.filter((g) => carried.has(norm(g.concept)))],
          (p) => `${norm(p.concept)}|${norm(p.misconception)}`,
        ),
        nQuestions,
        title: checkpointTitle(checkpointOrdinal(next, upcoming.id), nQuestions),
        // A quiz made before this miss can't re-test it; make a fresh one just in time.
        quizId: null,
      },
      nowIso,
    )
  }
  return closeItem(next, idx, nowIso, 'done')
}

/**
 * One probe per concept still carried, taken from the nearest upcoming checkpoint first (that is
 * where diagnosed misconceptions are stored), else from earlier ones; otherwise a generic probe.
 */
export function recentMisses(roadmap: Roadmap, limit = 5): Probe[] {
  const carried = new Map(roadmap.carry.map((c) => [norm(c), c]))
  if (carried.size === 0) return []
  const here = Math.max(0, currentIndex(roadmap))
  const distance = (i: CheckpointItem) => (i.idx >= here ? i.idx - here : 1000 + (here - i.idx))
  const checkpoints = roadmap.items.filter(isCheckpoint).sort((a, b) => distance(a) - distance(b))
  const probes = checkpoints.flatMap((cp) => cp.probes.filter((p) => carried.has(norm(p.concept))))
  const covered = new Set(probes.map((p) => norm(p.concept)))
  for (const [key, name] of carried) {
    if (!covered.has(key))
      probes.push({ concept: name, misconception: 'Got this wrong in the last checkpoint' })
  }
  return uniqueBy(probes, (p) => norm(p.concept)).slice(0, limit)
}

export function completionSummary(roadmap: Roadmap): string {
  const steps = roadmap.items.filter((i) => isLearn(i) && i.status === 'done').length
  const scored = roadmap.items.filter(isCheckpoint).filter((i) => i.score !== null)
  const scores = scored.map((i) => percent(i.score ?? 0))
  const average =
    scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null
  const parts = [
    `Roadmap complete: ${roadmap.title}.`,
    `${plural(steps, 'step')}, ${plural(scored.length, 'checkpoint')}${average === null ? '' : ` · ${average}% average`}.`,
    roadmap.carry.length > 0
      ? `Still shaky: ${roadmap.carry.join(', ')} — they'll come back in your reviews.`
      : 'Nothing left to carry over.',
  ]
  return parts.join(' ')
}
