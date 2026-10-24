/**
 * The subject a tap studies when no session runs: the subject of the newest encounter that was
 * not ignored (what Dumbledore extracted last), else the focus subject. Only active subjects
 * count; null means the picker should ask instead.
 */
import type { Repos } from '@engine/contracts'
import type { Id } from '@shared/domain'

/** How many recent encounters to look through for one with an active subject. */
const LOOKBACK = 50

export function lastStudiedSubject(
  repos: Pick<Repos, 'encounters' | 'subjects' | 'settings'>,
): Id | null {
  const active = new Set(repos.subjects.list({ status: ['active'] }).map((s) => s.id))
  if (active.size === 0) return null
  const recent = repos.encounters.list({ limit: LOOKBACK })
  const hit = recent.find(
    (e) => e.subjectId !== null && e.inboxState !== 'ignored' && active.has(e.subjectId),
  )
  if (hit?.subjectId) return hit.subjectId
  const focus = repos.settings.get().focusSubjectId
  return focus && active.has(focus) ? focus : null
}
