/**
 * Notes consolidation (docs/NOTES.md §5): one LLM pass per subject that rewrites concept
 * summaries from the notes, merges duplicates, keeps a clean subject ▸ topic ▸ concept tree and
 * adds prerequisite edges. When it runs, per subject:
 * - about 10 new or changed notes since the last pass (checked every few minutes);
 * - nightly: the first check after 03:00 local time, for every subject with any change;
 * - when the subject is opened in the app or the panel ('subject:viewed'), at most once per
 *   10 minutes, if anything changed since the last pass.
 * Never for the subject of a running study session. One pass at a time; a failed pass waits
 * 30 minutes before that subject is tried again. The model's answer is validated in ./apply.
 */
import type { Concept, Id, Note } from '@shared/domain'
import type { Brain, ConsolidateInput } from '../../brain-contract'
import type { Cancel, Clock } from '../../clock'
import type { Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import type { RelinkSupport } from '../../store/sqlite-repos'
import { applyConsolidation, type ConsolidationReport } from './apply'

export interface ConsolidationOptions {
  minNewNotes: number
  viewDebounceMs: number
  checkEveryMs: number
  /** Local hour after which the nightly pass may run. */
  nightlyHour: number
  retryAfterMs: number
  maxConcepts: number
  maxNotes: number
  timeoutMs: number
}

export const CONSOLIDATION_DEFAULTS: ConsolidationOptions = {
  minNewNotes: 10,
  viewDebounceMs: 10 * 60_000,
  checkEveryMs: 5 * 60_000,
  nightlyHour: 3,
  retryAfterMs: 30 * 60_000,
  maxConcepts: 60,
  maxNotes: 300,
  timeoutMs: 90_000,
}

export interface ConsolidationDeps {
  repos: Repos
  brain: Pick<Brain, 'consolidate'>
  bus: EngineBus
  clock: Clock
  /** SQLite's concept folding; without it concept merges are skipped. */
  relink?: RelinkSupport | null
  log?: (message: string, error?: unknown) => void
  options?: Partial<ConsolidationOptions>
}

export type ConsolidationReason = 'notes' | 'nightly' | 'viewed' | 'manual'

export interface ConsolidationService {
  start(): void
  stop(): void
  /** Asks for a pass (debounced for 'viewed'); resolves when the queued work is done. */
  request(subjectId: Id, reason: ConsolidationReason): Promise<void>
  /** Runs one pass now (no debounce, no change check); null when it could not run. */
  runNow(subjectId: Id): Promise<ConsolidationReport | null>
  /** The periodic check: "about 10 new notes" and the nightly pass. */
  check(): Promise<void>
}

export function createConsolidation(deps: ConsolidationDeps): ConsolidationService {
  const opts = { ...CONSOLIDATION_DEFAULTS, ...deps.options }
  const { repos, clock, bus } = deps
  const log = deps.log ?? (() => {})
  const lastView = new Map<Id, number>()
  const lastFailure = new Map<Id, number>()
  const queue: Id[] = []
  let running: Promise<void> | null = null
  let sessionSubject: Id | null = null
  let nightlyDay = ''
  const offs: (() => void)[] = []
  let timer: Cancel | null = null

  /** Notes added or changed since the subject's last pass (all of them if never). */
  const changedNotes = (subjectId: Id): Note[] => {
    const since = repos.subjects.consolidatedAt(subjectId)
    return repos.notes
      .list({ subjectId, status: null })
      .filter((n) => since === null || n.updatedAt > since)
  }

  const blocked = (subjectId: Id) => {
    if (subjectId === sessionSubject) return true
    const failed = lastFailure.get(subjectId)
    return failed !== undefined && clock.now() - failed < opts.retryAfterMs
  }

  const drain = (): Promise<void> => {
    // A run may be finishing (its loop already saw an empty queue): drain again after it.
    if (running) return running.then(() => (queue.length > 0 ? drain() : undefined))
    running = (async () => {
      while (queue.length > 0) {
        const subjectId = queue.shift() as Id
        if (blocked(subjectId) || !repos.subjects.get(subjectId)) continue
        await runNow(subjectId)
      }
    })().finally(() => {
      running = null
    })
    return running
  }

  const enqueue = (subjectId: Id): Promise<void> => {
    if (!queue.includes(subjectId)) queue.push(subjectId)
    return drain()
  }

  const buildInput = (subjectId: Id): ConsolidateInput | null => {
    const subject = repos.subjects.get(subjectId)
    if (!subject) return null
    const all = repos.concepts.listBySubject(subjectId)
    const active = repos.notes.list({ subjectId })
    if (active.length === 0) return null
    const since = repos.subjects.consolidatedAt(subjectId)
    // New notes first, then a sample of older ones (newest first), within the cap.
    const fresh = active.filter((n) => since === null || n.updatedAt > since)
    const older = active.filter((n) => !fresh.includes(n)).reverse()
    const notes = [...fresh.slice(-opts.maxNotes), ...older].slice(0, opts.maxNotes)
    const concepts = pickConcepts(all, notes, opts.maxConcepts)
    const ids = new Set(concepts.map((c) => c.id))
    const profile = repos.profile.get()
    return {
      subject: { id: subject.id, name: subject.name, goal: subject.goal },
      language: profile.promptLanguage,
      concepts: concepts.map((c) => ({
        id: c.id,
        name: c.name,
        parentId: c.parentId && ids.has(c.parentId) ? c.parentId : null,
        summary: c.summary,
        status: c.status,
        mastery: c.mastery,
      })),
      notes: notes.map((n) => ({
        id: n.id,
        conceptId: n.conceptId && ids.has(n.conceptId) ? n.conceptId : null,
        kind: n.kind,
        text: n.text,
        pinned: n.pinned,
      })),
      edges: repos.edges
        .list(subjectId)
        .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
        .map((e) => ({ fromId: e.fromId, toId: e.toId })),
    }
  }

  const runNow = async (subjectId: Id): Promise<ConsolidationReport | null> => {
    const startedAt = clock.nowIso()
    const input = buildInput(subjectId)
    if (!input) {
      if (repos.subjects.get(subjectId)) repos.subjects.markConsolidated(subjectId, startedAt)
      return null
    }
    try {
      const out = await deps.brain.consolidate(input, { timeoutMs: opts.timeoutMs })
      const report = repos.transaction(() => {
        const r = applyConsolidation(repos, subjectId, out, { relink: deps.relink })
        repos.subjects.markConsolidated(subjectId, startedAt)
        return r
      })
      lastFailure.delete(subjectId)
      if (report.skipped.length)
        log(`[consolidate] ${subjectId}: skipped ${report.skipped.join('; ')}`)
      bus.emit('memory:changed', { scope: 'concepts', ids: [] })
      bus.emit('memory:changed', { scope: 'subjects', ids: [subjectId] })
      return report
    } catch (error) {
      lastFailure.set(subjectId, clock.now())
      log(`[consolidate] ${subjectId} failed`, error)
      return null
    }
  }

  const check = async (): Promise<void> => {
    const now = new Date(clock.now())
    const day = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}`
    const nightly = now.getHours() >= opts.nightlyHour && day !== nightlyDay
    if (nightly) nightlyDay = day
    for (const s of repos.subjects.list({ status: ['active', 'suggested'] })) {
      const changed = changedNotes(s.id).length
      if (changed >= opts.minNewNotes || (nightly && changed > 0)) {
        if (!queue.includes(s.id)) queue.push(s.id)
      }
    }
    await drain()
  }

  const service: ConsolidationService = {
    start() {
      if (offs.length > 0) return
      offs.push(
        bus.on('subject:viewed', ({ subjectId }) => void service.request(subjectId, 'viewed')),
        bus.on('session:changed', ({ session }) => {
          sessionSubject =
            session && !['complete', 'error'].includes(session.phase) ? session.subjectId : null
        }),
      )
      // The first check waits a full interval: no pass right at startup.
      nightlyDay = (() => {
        const d = new Date(clock.now())
        return d.getHours() >= opts.nightlyHour
          ? `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
          : ''
      })()
      timer = clock.setInterval(() => void check(), opts.checkEveryMs)
    },
    stop() {
      for (const off of offs.splice(0)) off()
      timer?.()
      timer = null
    },
    request(subjectId, reason) {
      if (reason === 'viewed') {
        const last = lastView.get(subjectId)
        if (last !== undefined && clock.now() - last < opts.viewDebounceMs) return Promise.resolve()
        if (changedNotes(subjectId).length === 0) return Promise.resolve()
        lastView.set(subjectId, clock.now())
      }
      return enqueue(subjectId)
    },
    runNow,
    check,
  }
  return service
}

/**
 * The concepts sent to the model: every concept that holds a listed note, then the most recently
 * seen others, plus the ancestors of all of them so the tree is whole; at most `max`.
 */
export function pickConcepts(
  all: readonly Concept[],
  notes: readonly Note[],
  max: number,
): Concept[] {
  const byId = new Map(all.map((c) => [c.id, c]))
  const withNotes = new Set(notes.flatMap((n) => (n.conceptId ? [n.conceptId] : [])))
  const ranked = [...all].sort(
    (a, b) =>
      Number(withNotes.has(b.id)) - Number(withNotes.has(a.id)) ||
      (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
  )
  const keep = new Set<string>()
  for (const c of ranked) {
    const chain: string[] = []
    for (let x: Concept | undefined = c; x && !keep.has(x.id); x = byId.get(x.parentId ?? ''))
      chain.push(x.id)
    if (keep.size + chain.length > max) continue
    for (const id of chain) keep.add(id)
  }
  return all.filter((c) => keep.has(c.id))
}
