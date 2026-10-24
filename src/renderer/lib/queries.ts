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
}

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

// ─── Writes ─────────────────────────────────────────────────────────────────────────────────

/** Read channels each write channel can change; push events cover the rest. */
const AFFECTS: Partial<Record<InvokeChannel, InvokeChannel[]>> = {
  'settings.update': ['settings.get', 'app.getState'],
  'secrets.set': ['settings.get', 'app.getState'],
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
  'coach.runAction': ['session.get', 'exams.list', 'settings.get', 'app.getState'],
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
