/**
 * Roadmap history (Ilari, 2026-10-25: "every time a course gets updated the old gets removed. it
 * shall still be found from the history and if the user asks it can be pulled back and the new
 * one removed"). A subject shows one roadmap; when another takes its place — a replan
 * (adjust_roadmap), a new roadmap for the subject, or an earlier version brought back — the one
 * shown until then is superseded: kept whole (steps and their states, title, goal, created) with
 * when, by what and why, and hidden from everything that shows the current roadmap. Nothing is
 * ever deleted, so bringing a version back is undone by bringing the other one back.
 *
 * `roadmapHistory` and `restoreRoadmapVersion` are the service the IPC handlers and the chat use.
 */
import type { Id, Roadmap, RoadmapVersion } from '@shared/domain'
import type { Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import { StudyError } from './session-state'

/** Why the version shown until now was replaced, as the history lists it. */
export const SWAPPED_REASON = 'Swapped for an earlier version'
const REASON_CHARS = 120

export function replannedReason(instruction: string): string {
  return clip(`Replanned: ${instruction.trim()}`)
}

export function newRoadmapReason(goal: string): string {
  return clip(`New roadmap: ${goal.trim()}`)
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, ' ')
  return t.length <= REASON_CHARS ? t : `${t.slice(0, REASON_CHARS - 1).trimEnd()}…`
}

/** The roadmap a subject shows: its open one (newest touched), else its newest. */
export function shownRoadmap(repos: Repos, subjectId: Id): Roadmap | null {
  return repos.roadmaps.getActive(subjectId) ?? repos.roadmaps.listBySubject(subjectId)[0] ?? null
}

/**
 * Moves a roadmap into its subject's history. A running one is parked first (it keeps its
 * updatedAt); its items stay exactly as they are.
 */
export function supersedeRoadmap(
  repos: Repos,
  roadmap: Roadmap,
  info: { at: string; by: Id | null; reason: string },
): void {
  if (roadmap.status === 'active') repos.roadmaps.save({ ...roadmap, status: 'paused' })
  repos.roadmaps.supersede(roadmap.id, info)
}

/** The subject's earlier roadmap versions, most recently replaced first. */
export function roadmapHistory(repos: Repos, subjectId: Id): RoadmapVersion[] {
  return repos.roadmaps.history(subjectId)
}

export interface RoadmapRestored {
  /** The version that is the subject's roadmap again. */
  restored: Roadmap
  /** The roadmaps it moved into the history (usually the one shown until now). */
  replaced: Id[]
}

export interface RestoreDeps {
  repos: Repos
  bus: Pick<EngineBus, 'emit'>
  clock: { nowIso(): string }
}

/**
 * "Bring back": the earlier version `versionId` (a roadmap id from the history) becomes the
 * subject's roadmap again, its steps as they were; the roadmap shown until now goes into the
 * history ("Swapped for an earlier version"). It continues where the replaced one left off: a
 * running roadmap's place in the session passes to it (the study service follows on the
 * 'memory:changed' this emits). Restoring the replaced one again undoes it.
 */
export function restoreRoadmapVersion(deps: RestoreDeps, versionId: Id): RoadmapRestored {
  const { repos, clock } = deps
  const version = repos.roadmaps.version(versionId)
  if (!version) {
    throw new StudyError(
      repos.roadmaps.get(versionId)
        ? 'That roadmap is already the current one.'
        : 'That earlier version no longer exists.',
    )
  }
  const target = version.roadmap
  const now = clock.nowIso()
  const info = { at: now, by: target.id, reason: SWAPPED_REASON }
  const replaced: Id[] = []
  repos.transaction(() => {
    const shown = shownRoadmap(repos, target.subjectId)
    if (shown) {
      supersedeRoadmap(repos, shown, info)
      replaced.push(shown.id)
    }
    repos.roadmaps.unsupersede(target.id)
    const status: Roadmap['status'] =
      target.status === 'done' ? 'done' : shown?.status === 'active' ? 'active' : 'paused'
    repos.roadmaps.save({ ...target, status, updatedAt: now })
    // A finished version shows only once no open roadmap of the subject outranks it.
    for (let other = shownRoadmap(repos, target.subjectId); other && other.id !== target.id; ) {
      supersedeRoadmap(repos, other, info)
      replaced.push(other.id)
      other = shownRoadmap(repos, target.subjectId)
    }
  })
  deps.bus.emit('memory:changed', { scope: 'roadmaps', ids: [target.id, ...replaced] })
  const restored = repos.roadmaps.get(target.id)
  if (!restored) throw new StudyError('That earlier version no longer exists.')
  return { restored, replaced }
}
