/**
 * QueryService: the read models behind the app's pages (contracts.ts), as pure functions over
 * Repos + Clock. Nothing here writes.
 */
import type { Quiz } from '@shared/domain'
import { DEFAULT_ROUTES, PROVIDER_LIMITS, type ProviderId } from '@shared/llm'
import type { GapNote, QuizSummary, UsageSummary } from '@shared/state'
import type { Clock } from '../clock'
import type { QueryService, Repos } from '../contracts'
import { defaultGreetingName } from './greeting'
import { buildHome } from './home'
import { buildPicker } from './picker'
import { currentRoadmap, summarizeSubject } from './summary'
import { iso, startOfLocalDay } from './time'

export interface QueryServiceDeps {
  repos: Repos
  clock: Clock
  /** First name for the Home greeting; defaults to the macOS account name. */
  greetingName?: string | (() => string)
  /** Local midnight of the day containing a time; defaults to the system time zone. */
  startOfDay?: (ms: number) => number
  /** Caps for long lists. */
  limits?: Partial<{ inbox: number; search: number; subjectEncounters: number }>
}

export function toQuizSummary(q: Quiz): QuizSummary {
  return {
    id: q.id,
    kind: q.kind,
    title: q.title,
    subjectIds: q.subjectIds,
    score: q.score,
    questionCount: q.questions.length,
    createdAt: q.createdAt,
    completedAt: q.completedAt,
  }
}

/** Exams and reviews (not checkpoints or placements), newest first; failed generations hidden. */
/** Misconceptions from exams and questions the student asked, per topic, newest first. */
function gapNotesOf(repos: Repos, subjectId: string): GapNote[] {
  return repos.notes
    .list({ subjectId, status: 'active' })
    .filter((n) => n.kind === 'misconception' || n.kind === 'question')
    .reverse()
    .slice(0, 60)
    .map((n) => ({
      id: n.id,
      conceptId: n.conceptId,
      kind: n.kind === 'misconception' ? ('misconception' as const) : ('question' as const),
      text: n.text,
      createdAt: n.createdAt,
      source: n.source.title ?? n.source.app,
    }))
}

function examList(repos: Repos, subjectId?: string): QuizSummary[] {
  return [
    ...repos.quizzes.list({ kind: 'exam', subjectId }),
    ...repos.quizzes.list({ kind: 'review', subjectId }),
  ]
    .filter((q) => q.status !== 'failed')
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map(toQuizSummary)
}

function usageLimits(repos: Repos, rows: UsageSummary['rows']): UsageSummary['limits'] {
  const seen = new Map<string, { provider: string; model: string }>()
  const add = (provider: string, model: string) => {
    if (provider && model) seen.set(`${provider}|${model}`, { provider, model })
  }
  for (const routes of Object.values(DEFAULT_ROUTES))
    for (const r of routes) add(r.provider, r.model)
  for (const override of Object.values(repos.settings.get().ai.modelOverrides)) {
    const at = override.indexOf(':')
    if (at > 0) add(override.slice(0, at), override.slice(at + 1))
  }
  for (const row of rows) add(row.provider, row.model)
  return [...seen.values()].map(({ provider, model }) => {
    const limits = PROVIDER_LIMITS[provider as ProviderId]
    return {
      provider,
      model,
      requestsPerDay: limits?.requestsPerDay ?? null,
      tokensPerDay: limits?.tokensPerDay ?? null,
    }
  })
}

export function createQueryService(deps: QueryServiceDeps): QueryService {
  const { repos, clock } = deps
  const startOfDay = deps.startOfDay ?? startOfLocalDay
  const caps = { inbox: 500, search: 30, subjectEncounters: 200, ...deps.limits }
  let cachedName: string | null = null
  const greetingName = (): string => {
    if (typeof deps.greetingName === 'string') return deps.greetingName
    if (typeof deps.greetingName === 'function') return deps.greetingName()
    cachedName ??= defaultGreetingName()
    return cachedName
  }

  return {
    home: () => buildHome(repos, { nowMs: clock.now(), greetingName: greetingName(), startOfDay }),

    subjects: () => repos.subjects.list().map((s) => summarizeSubject(repos, s, clock.now())),

    subject(id) {
      const subject = repos.subjects.get(id)
      if (!subject) throw new Error(`subject ${id} not found`)
      return {
        subject: summarizeSubject(repos, subject, clock.now()),
        roadmap: currentRoadmap(repos, id),
        concepts: repos.concepts.listBySubject(id),
        encounters: repos.encounters
          .list({ subjectId: id, limit: caps.subjectEncounters })
          .filter((e) => e.inboxState !== 'ignored'),
        exams: examList(repos, id),
        assignments: repos.assignments
          .list({ subjectId: id })
          .filter((a) => a.status !== 'dismissed'),
        gapNotes: gapNotesOf(repos, id),
      }
    },

    inbox: (filter) =>
      repos.encounters.list({
        inboxState: filter.state,
        subjectId: filter.subjectId,
        limit: caps.inbox,
      }),

    exams: () => examList(repos),

    search: (q) => repos.search.query(q, caps.search),

    usage() {
      const rows = repos.usage.rowsSince(iso(startOfDay(clock.now())))
      return { rows, limits: usageLimits(repos, rows) }
    },

    picker: () => buildPicker(repos, clock.now()),
  }
}
