/**
 * Roadmap planning (P3, PLAN F2 step 4 / R40): memory → context → roadmapper under a deadline →
 * validated plan → stored Roadmap. Also the storage rules around it: one open roadmap per subject
 * is 'active', and parked roadmaps keep their updatedAt so the newest stays first.
 */
import type { Id, Roadmap, Subject } from '@shared/domain'
import { RoadmapPlan } from '../../brain-contract'
import type { Repos } from '../../contracts'
import { assembleRoadmapContext } from './context'
import { errorMessage, withDeadline } from './deadline'
import type { StudyDeps, StudyOptions } from './deps'
import { materializeRoadmap } from './materialize'
import { StudyError } from './session-state'

export interface PlanRequest {
  id: Id
  subject: Subject
  goal: string
  question: string | null
  assistant: string
}

export async function planRoadmap(
  deps: Pick<StudyDeps, 'repos' | 'brain' | 'clock'>,
  opts: Pick<StudyOptions, 'roadmapTimeoutMs'>,
  req: PlanRequest,
): Promise<Roadmap> {
  const { repos, brain, clock } = deps
  const context = assembleRoadmapContext(repos, {
    subject: req.subject,
    goal: req.goal,
    assistant: req.assistant,
    question: req.question,
    nowIso: clock.nowIso(),
  })
  let plan: RoadmapPlan
  try {
    const raw = await withDeadline(clock, opts.roadmapTimeoutMs, 'buildRoadmap', (call) =>
      brain.buildRoadmap(context.input, call),
    )
    plan = RoadmapPlan.parse(raw)
  } catch (error) {
    throw new StudyError(`Couldn't build a roadmap: ${errorMessage(error)}`, { cause: error })
  }
  return materializeRoadmap({
    id: req.id,
    subjectId: req.subject.id,
    plan,
    carry: context.carry,
    noHistory: context.noHistory,
    nowIso: clock.nowIso(),
  })
}

/** Stores a new roadmap as its subject's active one; older active ones are parked. */
export function commitRoadmap(repos: Repos, roadmap: Roadmap): void {
  repos.transaction(() => {
    for (const old of repos.roadmaps.listBySubject(roadmap.subjectId)) {
      if (old.id !== roadmap.id && old.status === 'active') {
        repos.roadmaps.save({ ...old, status: 'paused' })
      }
    }
    repos.roadmaps.save(roadmap)
  })
}

/** Parks a roadmap that stops being the running session (it stays resumable). */
export function parkRoadmap(repos: Repos, roadmapId: Id, nowIso: string): void {
  const roadmap = repos.roadmaps.get(roadmapId)
  if (roadmap?.status === 'active')
    repos.roadmaps.save({ ...roadmap, status: 'paused', updatedAt: nowIso })
}

/**
 * Persists a roadmap change and announces it. The transition to 'done' fires the follow-up hook
 * (lane L5 schedules the review) exactly once.
 */
export function saveRoadmap(
  deps: Pick<StudyDeps, 'repos' | 'bus' | 'followUp'>,
  before: Roadmap,
  after: Roadmap,
): void {
  deps.repos.roadmaps.save(after)
  deps.bus.emit('memory:changed', { scope: 'roadmaps', ids: [after.id] })
  if (before.status === 'done' || after.status !== 'done') return
  try {
    deps.followUp?.onSessionComplete(after.id)
  } catch (error) {
    console.warn('[study] onSessionComplete failed', error)
  }
}
