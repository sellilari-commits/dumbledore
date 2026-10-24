/**
 * What a tap studies when no session runs. The current topic decides, the same one the mini
 * panel marks (shared/topics.ts): a locked topic (settings.focusTopicId) studies that topic in its
 * subject (the topic name is the goal, so later taps resume its roadmap); otherwise the subject of
 * the topic that most recently got new information, as a whole. Without topics: the subject of the
 * newest encounter that was not ignored, else the focus subject. Only active subjects count there;
 * null means the picker should ask instead.
 */
import type { Repos } from '@engine/contracts'
import type { Id } from '@shared/domain'
import { currentTopic, listTopics } from '@shared/topics'

/** How many recent encounters to look through for one with an active subject. */
const LOOKBACK = 50

export interface TapTarget {
  subjectId: Id
  /** The locked topic's name, or null to continue the subject. */
  goal: string | null
}

export function tapTarget(
  repos: Pick<Repos, 'encounters' | 'subjects' | 'settings' | 'concepts'>,
): TapTarget | null {
  const lockedId = repos.settings.get().focusTopicId ?? null
  const topics = listTopics(repos.subjects.list(), (id) => repos.concepts.listBySubject(id))
  const topic = currentTopic(topics, lockedId)
  if (topic) return { subjectId: topic.subjectId, goal: topic.id === lockedId ? topic.name : null }
  const subjectId = lastStudiedSubject(repos)
  return subjectId ? { subjectId, goal: null } : null
}

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
