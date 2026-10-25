/**
 * The Ask bar's topic chips (chat mode): every topic the mini panel lists (shared/topics.ts: the
 * top-level concepts of every active or suggested subject, newest information first), kept as live
 * as the panel's list: reloaded when memory changes (`memory.changed` for a scope that touches
 * subjects or concepts, as lib/live.ts invalidates the panel's queries, and `session.changed`) and
 * every time the bar is shown (main reuses the hidden window and sends it `navigate` on each open;
 * a window `focus` is not guaranteed then). A selected topic stays selected while it still exists.
 * One topic can be selected; its subject goes with every question
 * as context (`ask.submit` `subjectId`), and ↵ on an empty input studies it the way a tap studies
 * a locked topic (`session.start` with the topic's name as the goal; main pastes the next prompt
 * into the AI chat) and closes the bar.
 */
import type { SubjectSummary } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import type { MemoryScope } from '@shared/state'
import { listTopics, type Topic, topicSubjects } from '@shared/topics'
import { useCallback, useEffect, useState } from 'react'
import { errorMessage, report } from '../overlay/lib/bridge'

export type { Topic }

export interface TopicsController {
  topics: Topic[]
  /** The selected topic, or null. */
  selected: Topic | null
  /** Selects a topic, or deselects it when it is already selected. */
  toggle: (id: string) => void
  /** ←/→: moves the selection one topic (the first one when nothing is selected). */
  move: (step: -1 | 1) => void
  /** Studies the selected topic and closes the bar; false when nothing happened. */
  study: () => Promise<boolean>
  starting: boolean
  error: string | null
}

/** Every topic of the counted subjects, as the mini panel lists them. */
export async function loadTopics(api: DumbledoreApi): Promise<Topic[]> {
  const pool: SubjectSummary[] = topicSubjects(await api.invoke('subjects.list'))
  const details = await Promise.all(
    pool.map((s) =>
      api.invoke('subjects.get', s.id).catch((e: unknown) => {
        report(e, 'subjects.get')
        return null
      }),
    ),
  )
  const concepts = new Map(pool.map((s, i) => [s.id, details[i]?.concepts ?? []]))
  return listTopics(pool, (id) => concepts.get(id) ?? [])
}

/** Memory scopes whose changes reach the topic list (the ones lib/live.ts maps to subjects.list/get). */
export const TOPIC_SCOPES: ReadonlySet<MemoryScope> = new Set([
  'subjects',
  'concepts',
  'inbox',
  'roadmaps',
])

/** The index `step` away from `current` (-1 = none), kept inside the row. */
export function moveIndex(current: number, step: -1 | 1, count: number): number {
  if (count === 0) return -1
  if (current < 0) return 0
  return Math.max(0, Math.min(count - 1, current + step))
}

/** `enabled`: chat mode; the prompt box (route 'prompt') shows no topics and loads none. */
export function useTopics(api: DumbledoreApi, close: () => void, enabled = true): TopicsController {
  const [topics, setTopics] = useState<Topic[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!enabled) return
    let live = true
    // One load at a time; a change during a load reloads once more after it, so the last
    // answer always reflects the latest memory.
    let loading = false
    let again = false
    const load = () => {
      if (loading) {
        again = true
        return
      }
      loading = true
      loadTopics(api)
        .then((next) => {
          if (!live) return
          setTopics(next)
          setSelectedId((id) => (id && next.some((t) => t.id === id) ? id : null))
        })
        .catch((e: unknown) => report(e, 'subjects.list'))
        .finally(() => {
          loading = false
          if (live && again) {
            again = false
            load()
          }
        })
    }
    load()
    const offs = [
      api.on('memory.changed', ({ scope }) => {
        if (TOPIC_SCOPES.has(scope)) load()
      }),
      api.on('session.changed', () => load()),
      api.on('navigate', () => load()),
    ]
    window.addEventListener('focus', load)
    return () => {
      live = false
      for (const off of offs) off()
      window.removeEventListener('focus', load)
    }
  }, [api, enabled])

  const selected = topics.find((t) => t.id === selectedId) ?? null

  const toggle = useCallback((id: string) => {
    setError(null)
    setSelectedId((now) => (now === id ? null : id))
  }, [])

  const move = useCallback(
    (step: -1 | 1) => {
      setError(null)
      setSelectedId((now) => {
        const index = moveIndex(
          topics.findIndex((t) => t.id === now),
          step,
          topics.length,
        )
        return topics[index]?.id ?? null
      })
    },
    [topics],
  )

  const study = useCallback(async () => {
    if (!selected || starting) return false
    setStarting(true)
    setError(null)
    try {
      await api.invoke('session.start', {
        subjectId: selected.subjectId,
        goal: selected.name,
        question: null,
      })
      close()
      return true
    } catch (e) {
      setError(errorMessage(e))
      return false
    } finally {
      setStarting(false)
    }
  }, [api, close, selected, starting])

  return { topics, selected, toggle, move, study, starting, error }
}
