/**
 * Push events → query cache. 'memory.changed' invalidates the read models of its scope,
 * 'state.changed' and 'session.changed' write their payload straight into the cache, and
 * 'navigate' asks the window to show a route.
 */
import type { InvokeChannel } from '@shared/ipc'
import type { MemoryScope } from '@shared/state'
import { type QueryClient, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { on } from './api'
import { invalidateChannels, keys } from './queries'

export const SCOPE_CHANNELS: Record<MemoryScope, InvokeChannel[]> = {
  subjects: [
    'subjects.list',
    'subjects.get',
    'subjects.tree',
    'notes.loose',
    'home.get',
    'session.picker',
    'search.query',
    'roadmaps.history',
  ],
  concepts: [
    'subjects.get',
    'subjects.tree',
    'subjects.list',
    'home.get',
    'session.picker',
    'search.query',
  ],
  inbox: [
    'inbox.list',
    'notes.loose',
    'subjects.get',
    'subjects.tree',
    'subjects.list',
    'home.get',
    'session.picker',
  ],
  roadmaps: [
    'subjects.get',
    'subjects.list',
    'home.get',
    'session.picker',
    'session.get',
    'roadmaps.history',
  ],
  quizzes: ['exams.list', 'quiz.get', 'subjects.get', 'home.get'],
  assignments: ['home.get', 'subjects.get'],
  profile: ['home.get', 'profile.get'],
  chat: ['chat.history'],
  nudges: ['home.get'],
  settings: ['settings.get', 'app.getState'],
}

export function subscribeLive(qc: QueryClient, onNavigate?: (route: string) => void): () => void {
  const offs = [
    on('memory.changed', ({ scope }) => invalidateChannels(qc, SCOPE_CHANNELS[scope] ?? [])),
    on('state.changed', (state) => qc.setQueryData(keys.appState(), state)),
    on('session.changed', (session) => {
      qc.setQueryData(keys.session(), session)
      invalidateChannels(qc, ['home.get', 'subjects.get', 'subjects.list', 'session.picker'])
    }),
    on('navigate', ({ route }) => onNavigate?.(route)),
  ]
  return () => {
    for (const off of offs) off()
  }
}

/** Mount once per window, inside the QueryClientProvider. */
export function useLiveUpdates(onNavigate?: (route: string) => void): void {
  const qc = useQueryClient()
  useEffect(() => subscribeLive(qc, onNavigate), [qc, onNavigate])
}
