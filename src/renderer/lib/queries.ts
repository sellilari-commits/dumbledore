/**
 * TanStack Query hooks over the IPC contract: one query per read channel, one mutation helper
 * for every write channel. Query keys start with the channel name so push events (./live) and
 * mutations can invalidate by channel.
 */
import type { InboxState } from '@shared/domain'
import type { InvokeArgs, InvokeChannel, InvokeReq, InvokeRes } from '@shared/ipc'
import {
  type QueryClient,
  type UseMutationOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query'
import { invoke } from './api'

export const keys = {
  appState: () => ['app.getState'] as const,
  settings: () => ['settings.get'] as const,
  permissions: () => ['permissions.status'] as const,
  usage: () => ['providers.usage'] as const,
  home: () => ['home.get'] as const,
  subjects: () => ['subjects.list'] as const,
  subject: (id: string) => ['subjects.get', id] as const,
  inbox: (state: InboxState | null, subjectId: string | null) =>
    ['inbox.list', state, subjectId] as const,
  exams: () => ['exams.list'] as const,
  search: (q: string) => ['search.query', q] as const,
  session: () => ['session.get'] as const,
  picker: () => ['session.picker'] as const,
  quiz: (id: string) => ['quiz.get', id] as const,
  chat: (thread: string) => ['chat.history', thread] as const,
  profile: () => ['profile.get'] as const,
  providerCheck: (id: ProviderKey) => ['providers.test', id] as const,
}

/** Provider ids 'providers.test' accepts (gemini, apple, groq, ovh, mistral). */
export type ProviderKey = InvokeReq<'providers.test'>

export function invalidateChannels(qc: QueryClient, channels: readonly InvokeChannel[]): void {
  for (const ch of channels) void qc.invalidateQueries({ queryKey: [ch] })
}

// ─── Reads ──────────────────────────────────────────────────────────────────────────────────

export const useAppState = () =>
  useQuery({ queryKey: keys.appState(), queryFn: () => invoke('app.getState') })
export const useSettings = () =>
  useQuery({ queryKey: keys.settings(), queryFn: () => invoke('settings.get') })
export const usePermissions = (poll = false) =>
  useQuery({
    queryKey: keys.permissions(),
    queryFn: () => invoke('permissions.status'),
    refetchInterval: poll ? 1000 : false,
  })
export const useUsage = () =>
  useQuery({ queryKey: keys.usage(), queryFn: () => invoke('providers.usage') })
export const useHome = () => useQuery({ queryKey: keys.home(), queryFn: () => invoke('home.get') })
export const useSubjects = () =>
  useQuery({ queryKey: keys.subjects(), queryFn: () => invoke('subjects.list') })
export const useSubject = (id: string) =>
  useQuery({ queryKey: keys.subject(id), queryFn: () => invoke('subjects.get', id) })
export const useInbox = (state: InboxState | null, subjectId: string | null = null) =>
  useQuery({
    queryKey: keys.inbox(state, subjectId),
    queryFn: () => invoke('inbox.list', { state, subjectId }),
  })
export const useExams = () =>
  useQuery({ queryKey: keys.exams(), queryFn: () => invoke('exams.list') })
export const useSearch = (q: string) =>
  useQuery({
    queryKey: keys.search(q),
    queryFn: () => invoke('search.query', q),
    enabled: q.trim().length > 0,
    placeholderData: (prev) => prev,
  })
export const useSession = () =>
  useQuery({ queryKey: keys.session(), queryFn: () => invoke('session.get') })
export const usePicker = () =>
  useQuery({ queryKey: keys.picker(), queryFn: () => invoke('session.picker') })
export const useQuiz = (id: string) =>
  useQuery({ queryKey: keys.quiz(id), queryFn: () => invoke('quiz.get', id) })
export const useChatHistory = (thread: string) =>
  useQuery({ queryKey: keys.chat(thread), queryFn: () => invoke('chat.history', thread) })
export const useProfile = () =>
  useQuery({ queryKey: keys.profile(), queryFn: () => invoke('profile.get') })

/**
 * A provider's connection check as a cached query, so Settings and Onboarding can show a live
 * status ("Using key from Hugo project ✓") without a click. `refetch()` is the Test button.
 * Saving a key ('secrets.set') invalidates it.
 */
export const useProviderCheck = (id: ProviderKey, enabled = true) =>
  useQuery({
    queryKey: keys.providerCheck(id),
    queryFn: () => invoke('providers.test', id),
    enabled,
    staleTime: 5 * 60_000,
    retry: 0,
    refetchOnWindowFocus: false,
  })

// ─── Writes ─────────────────────────────────────────────────────────────────────────────────

/** Read channels each write channel can change; push events cover the rest. */
const AFFECTS: Partial<Record<InvokeChannel, InvokeChannel[]>> = {
  'settings.update': ['settings.get', 'app.getState'],
  'secrets.set': ['settings.get', 'app.getState', 'providers.test'],
  'profile.update': ['profile.get', 'home.get'],
  'capture.setEnabled': ['settings.get', 'app.getState'],
  'subjects.create': ['subjects.list', 'home.get', 'session.picker'],
  'subjects.update': ['subjects.list', 'subjects.get', 'home.get', 'session.picker'],
  'suggested.act': ['subjects.list', 'subjects.get', 'inbox.list', 'home.get'],
  'inbox.act': ['inbox.list', 'subjects.get', 'subjects.list', 'home.get'],
  'assignments.add': ['home.get', 'subjects.get'],
  'session.start': ['session.get', 'home.get', 'subjects.get', 'subjects.list'],
  'session.next': ['session.get', 'home.get', 'subjects.get', 'subjects.list'],
  'session.end': ['session.get', 'home.get', 'subjects.get'],
  'quiz.finish': ['exams.list', 'quiz.get', 'home.get', 'subjects.get'],
  'exams.create': ['exams.list', 'subjects.get'],
  // start_roadmap, create_exam, start_review and set_focus between them touch all of these.
  'coach.runAction': [
    'session.get',
    'session.picker',
    'subjects.get',
    'subjects.list',
    'home.get',
    'exams.list',
    'settings.get',
    'app.getState',
  ],
}

type MutationOpts<C extends InvokeChannel> = Omit<
  UseMutationOptions<InvokeRes<C>, Error, InvokeReq<C>>,
  'mutationFn'
>

/** A mutation for any write channel; invalidates what that channel affects on success. */
export function useAction<C extends InvokeChannel>(channel: C, opts: MutationOpts<C> = {}) {
  const qc = useQueryClient()
  return useMutation<InvokeRes<C>, Error, InvokeReq<C>>({
    ...opts,
    mutationFn: (req) => invoke(channel, ...([req] as unknown as InvokeArgs<C>)),
    onSuccess: (data, vars, result, context) => {
      invalidateChannels(qc, AFFECTS[channel] ?? [])
      return opts.onSuccess?.(data, vars, result, context)
    },
  })
}

/** Saves "About you"; the returned profile goes straight into the cache. */
export function useUpdateProfile(opts: MutationOpts<'profile.update'> = {}) {
  const qc = useQueryClient()
  return useAction('profile.update', {
    ...opts,
    onSuccess: (profile, vars, result, context) => {
      qc.setQueryData(keys.profile(), profile)
      return opts.onSuccess?.(profile, vars, result, context)
    },
  })
}

/** Writes the JSON export; main returns its path (and shows it in Finder). */
export const useExportData = (opts: MutationOpts<'data.export'> = {}) =>
  useAction('data.export', opts)

/**
 * Erases everything. On success every cached read model is reset (and active ones refetched)
 * before `onSuccess` runs, so the caller can navigate on fresh data (e.g. back to onboarding).
 */
export function useDeleteAllData(opts: MutationOpts<'data.deleteAll'> = {}) {
  const qc = useQueryClient()
  return useMutation<InvokeRes<'data.deleteAll'>, Error, InvokeReq<'data.deleteAll'>>({
    ...opts,
    mutationFn: (req) => invoke('data.deleteAll', req),
    onSuccess: async (data, vars, result, context) => {
      await qc.resetQueries()
      return opts.onSuccess?.(data, vars, result, context)
    },
  })
}
