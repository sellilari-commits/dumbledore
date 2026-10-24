/**
 * The Ask bar's topic row (chat mode): the subjects studied most recently (`session.picker`, at
 * most TOPIC_LIMIT, reloaded whenever the window comes back). One topic can be selected; it goes
 * with every question as context (`ask.submit` `subjectId`), and ↵ on an empty input studies it
 * (`session.start`, main pastes that subject's next prompt into the AI chat) and closes the bar.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { PickerData } from '@shared/state'
import { useCallback, useEffect, useState } from 'react'
import { errorMessage, report } from '../overlay/lib/bridge'

export const TOPIC_LIMIT = 12

export interface Topic {
  id: string
  name: string
  emoji: string
}

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

/** Most recently studied first (never studied last, picker order kept), at most TOPIC_LIMIT. */
export function topicsFrom(data: PickerData): Topic[] {
  const studied = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0)
  return data.subjects
    .map(({ subject }) => subject)
    .sort((a, b) => studied(b.lastStudiedAt) - studied(a.lastStudiedAt))
    .slice(0, TOPIC_LIMIT)
    .map(({ id, name, emoji }) => ({ id, name, emoji }))
}

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
    const load = () => {
      api
        .invoke('session.picker')
        .then((data) => {
          if (!live) return
          const next = topicsFrom(data)
          setTopics(next)
          setSelectedId((id) => (id && next.some((t) => t.id === id) ? id : null))
        })
        .catch((e: unknown) => report(e, 'session.picker'))
    }
    load()
    window.addEventListener('focus', load)
    return () => {
      live = false
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
      await api.invoke('session.start', { subjectId: selected.id, goal: null, question: null })
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
