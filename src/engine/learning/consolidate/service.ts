/**
 * Notes consolidation (docs/NOTES.md §5): one LLM pass per subject that rewrites concept
 * summaries from the notes, merges duplicates, keeps a clean subject ▸ topic ▸ concept tree and
 * adds prerequisite edges. When it runs, per subject:
 * - about 10 new or changed notes since the last pass (checked every few minutes);
 * - nightly: the first check after 03:00 local time, for every subject with any change;
 * - when the subject is opened in the app or the panel ('subject:viewed'), at most once per
 *   10 minutes, if anything changed since the last pass;
 * - about 30 s after a new source (a page not seen in the subject before) adds notes to it, so
 *   pages about the same thing unite into one topic and its big picture is rewritten.
 * Never for the subject of a running study session. One pass at a time; a failed pass waits
 * 30 minutes before that subject is tried again. The model's answer is validated in ./apply.
 */
import type { Concept, Id, Note } from '@shared/domain'
import type { Brain, ConsolidateInput } from '../../brain-contract'
import type { Cancel, Clock } from '../../clock'
import type { Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import { sourceKey, sourceLabel } from '../../memory/sources'
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
  /** Wait after a new source joins a subject, so a few pages read together go in one pass. */
  sourceDebounceMs: number
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
  sourceDebounceMs: 30_000,
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

export type ConsolidationReason = 'notes' | 'nightly' | 'viewed' | 'manual' | 'source'

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
  /** Sources each subject had at its last pass (lazily from notes older than that pass). */
  const knownSources = new Map<Id, Set<string>>()
  const sourceTimers = new Map<Id, Cancel>()
  /** New sources already waiting for a pass, so further events don't push the pass back. */
  const pendingSources = new Map<Id, Set<string>>()

  const sourcesOf = (notes: readonly Note[]) => new Set(notes.map((n) => sourceKey(n.source)))
  const baselineSources = (subjectId: Id): Set<string> => {
    const since = repos.subjects.consolidatedAt(subjectId)
    if (since === null) return new Set()
    return sourcesOf(repos.notes.list({ subjectId }).filter((n) => n.updatedAt <= since))
  }

  /** A page the subject had no notes from at its last pass → a pass ~30 s later. */
  const noticeSources = (subjectId: Id) => {
    if (!repos.subjects.get(subjectId)) return
    const known = knownSources.get(subjectId) ?? baselineSources(subjectId)
    knownSources.set(subjectId, known)
    const pending = pendingSources.get(subjectId) ?? new Set<string>()
    const fresh = [...sourcesOf(repos.notes.list({ subjectId }))].filter(
      (k) => !known.has(k) && !pending.has(k),
    )
    if (fresh.length === 0) return
    for (const k of fresh) pending.add(k)
    pendingSources.set(subjectId, pending)
    sourceTimers.get(subjectId)?.()
    sourceTimers.set(
      subjectId,
      clock.setTimeout(() => {
        sourceTimers.delete(subjectId)
        pendingSources.delete(subjectId)
        void service.request(subjectId, 'source')
      }, opts.sourceDebounceMs),
    )
  }

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
        source: sourceLabel(n.source),
      })),
      edges: repos.edges
        .list(subjectId)
        .filter((e) => ids.has(e.fromId) && ids.has(e.toId))
        .map((e) => ({ fromId: e.fromId, toId: e.toId })),
      otherSubjects: repos.subjects
        .list({ status: ['active'] })
        .filter((s) => s.id !== subjectId)
        .map((s) => ({ id: s.id, name: s.name })),
    }
  }

  const runNow = async (subjectId: Id): Promise<ConsolidationReport | null> => {
    const startedAt = clock.nowIso()
    // Sources the pass sees; a page whose notes arrive during it still counts as new afterwards.
    const seenSources = sourcesOf(repos.notes.list({ subjectId }))
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
      knownSources.set(subjectId, seenSources)
      for (const target of report.movedTo) knownSources.delete(target)
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
        bus.on('memory:changed', ({ scope, ids }) => {
          if (scope !== 'subjects') return
          for (const id of ids) noticeSources(id)
        }),
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
      for (const cancel of sourceTimers.values()) cancel()
      sourceTimers.clear()
      pendingSources.clear()
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
