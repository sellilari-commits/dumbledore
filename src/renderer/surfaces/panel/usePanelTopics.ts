/**
 * The panel's topics and its lock, read once in MiniPanel and passed down so the header's lock
 * and the list always agree. Topics come from every counted subject (shared/topics.ts). The
 * current topic is the locked one (settings.focusTopicId), else the newest. Locking a topic (from
 * the header or a topic's detail) focuses its subject; unlocking clears both, so the panel follows
 * the latest again.
 * Saving is shown optimistically.
 */
import { invoke } from '@renderer/lib/api'
import { keys, useAction, useSettings, useSubjects } from '@renderer/lib/queries'
import type { Concept, SettingsPatch } from '@shared/domain'
import { currentTopic, listTopics, type Topic, topicSubjects } from '@shared/topics'
import { useQueries } from '@tanstack/react-query'
import { report } from './panel-actions'

export interface PanelTopics {
  topics: Topic[]
  current: Topic | null
  locked: boolean
  /** Makes `topic` current and locks it. */
  lock: (topic: Topic) => void
  /** Follows the newest topic again. */
  unlock: () => void
  /** Locks the current topic, or unlocks to follow the latest. */
  toggleLock: () => void
  loading: boolean
  error: unknown
}

function pendingLock(vars: SettingsPatch | undefined): string | null | undefined {
  return vars && 'focusTopicId' in vars ? (vars.focusTopicId ?? null) : undefined
}

export function usePanelTopics(): PanelTopics {
  const settings = useSettings()
  const subjects = useSubjects()
  const update = useAction('settings.update', { onError: report })
  const pool = topicSubjects(subjects.data ?? [])
  const details = useQueries({
    queries: pool.map((s) => ({
      queryKey: keys.subject(s.id),
      queryFn: () => invoke('subjects.get', s.id),
    })),
  })
  const concepts = new Map<string, Concept[]>()
  for (const [i, s] of pool.entries()) concepts.set(s.id, details[i]?.data?.concepts ?? [])
  const topics = listTopics(pool, (id) => concepts.get(id) ?? [])

  const optimistic = update.isPending ? pendingLock(update.variables) : undefined
  const lockedId = optimistic === undefined ? (settings.data?.focusTopicId ?? null) : optimistic
  const current = currentTopic(topics, lockedId)
  const locked = lockedId !== null && current?.id === lockedId

  const lock = (t: Topic) => {
    if (!(locked && t.id === lockedId))
      update.mutate({ focusTopicId: t.id, focusSubjectId: t.subjectId })
  }
  const unlock = () => update.mutate({ focusTopicId: null, focusSubjectId: null })
  return {
    topics,
    current,
    locked,
    lock,
    unlock,
    toggleLock: () => {
      if (locked) unlock()
      else if (current) lock(current)
    },
    loading: subjects.isLoading || settings.isLoading || details.some((d) => d.isLoading),
    error: subjects.error ?? settings.error ?? details.find((d) => d.error)?.error ?? null,
  }
}
