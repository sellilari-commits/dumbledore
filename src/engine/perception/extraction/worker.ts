/**
 * Extraction worker (docs/PLAN.md §5.3 F1 steps 4–6, §6.4 "Extraction queue", "Retention").
 *
 * Closed episodes pass the local prefilter or are marked done without an LLM call (episodes that
 * arrive already done, coding agent sessions, are skipped outright). Passing ones
 * queue up and go to `Brain.extract` in batches (≤ 3 episodes or a token cap), every 2 minutes,
 * or at once for AI-chat episodes during a study session. A daily budget caps calls and tokens,
 * sized for a whole day of normal use. Results are applied through Repos (./apply), episodes are
 * marked extracted and 'memory:changed' is emitted. Hourly, episode text past the retention window
 * is purged and episodes still unextracted in the DB (queue overflow, a provider outage that used
 * up their attempts, yesterday's budget) are queued again, so nothing waits for an app restart.
 */
import type { Concept, Episode } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import { type Brain, type ExtractInput, ExtractOutput } from '../../brain-contract'
import type { Cancel, Clock } from '../../clock'
import type { MasteryModel, Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import { redact } from '../../privacy/redact'
import { HOUR, MINUTE } from '../types'
import { type ApplyOutcome, applyExtraction, PromptMemory } from './apply'
import { DailyBudget, estimateTokens } from './budget'
import { type PrefilterOptions, type PrefilterResult, prefilter } from './prefilter'

export interface WorkerOptions {
  maxBatch: number
  maxBatchTokens: number
  maxEpisodeChars: number
  flushEveryMs: number
  purgeEveryMs: number
  dailyMaxCalls: number
  dailyMaxTokens: number
  maxAttempts: number
  maxQueue: number
  timeoutMs: number
  prefilter: Partial<PrefilterOptions>
}

export const WORKER_DEFAULTS: WorkerOptions = {
  maxBatch: 3,
  maxBatchTokens: 4000,
  maxEpisodeChars: 6000,
  flushEveryMs: 2 * MINUTE,
  purgeEveryMs: HOUR,
  // A batch is ≤ 4k tokens: ~300 batches ≈ a full day of reading and AI chats. On Gemini Flash-Lite
  // that is ~€0.10 at most; the brain's spend cap and per-provider limits still apply on top.
  dailyMaxCalls: 400,
  dailyMaxTokens: 1_200_000,
  maxAttempts: 3,
  maxQueue: 200,
  timeoutMs: 60_000,
  prefilter: {},
}

export interface ExtractionWorkerDeps {
  repos: Repos
  brain: Pick<Brain, 'extract'>
  bus: EngineBus
  clock: Clock
  mastery?: MasteryModel | null
  /** Called for every episode that got a subject (feeds "Right now"). */
  onEpisodeSubject?: (episodeId: string, subjectId: string) => void
  log?: (message: string, error?: unknown) => void
  options?: Partial<WorkerOptions>
}

interface QueueItem {
  episode: Episode
  score: number
  urgent: boolean
  attempts: number
  seq: number
}

const PROMPT_OVERHEAD_TOKENS = 600
const ACTIVE_PHASES = new Set(['planning', 'step', 'checkpoint'])

export class ExtractionWorker {
  private readonly opts: WorkerOptions
  private readonly budget: DailyBudget
  private readonly prompts = new PromptMemory()
  private queue: QueueItem[] = []
  /** Episodes in a running LLM call, so a recovery pass never queues them twice. */
  private readonly inFlight = new Set<string>()
  private seq = 0
  private cancels: Cancel[] = []
  private offs: (() => void)[] = []
  private sessionActive = false
  private running: Promise<void> | null = null
  private again = false
  private budgetWarned = false

  constructor(private readonly deps: ExtractionWorkerDeps) {
    this.opts = { ...WORKER_DEFAULTS, ...deps.options }
    this.budget = new DailyBudget({
      maxCalls: this.opts.dailyMaxCalls,
      maxTokens: this.opts.dailyMaxTokens,
    })
  }

  get pending(): number {
    return this.queue.length
  }

  budgetLeft(): { calls: number; tokens: number } {
    return this.budget.left(this.deps.clock.now())
  }

  start(): void {
    if (this.offs.length > 0) return
    const { bus, clock } = this.deps
    this.offs.push(
      bus.on('perception:episodeClosed', ({ episode }) => void this.enqueue(episode)),
      bus.on('session:changed', ({ session }) => {
        this.sessionActive = session !== null && ACTIVE_PHASES.has(session.phase)
        if (this.sessionActive && this.queue.some((i) => i.episode.kind === 'ai_chat')) {
          for (const i of this.queue) if (i.episode.kind === 'ai_chat') i.urgent = true
          void this.flushNow()
        }
      }),
    )
    this.cancels.push(
      clock.setInterval(() => void this.flushNow(), this.opts.flushEveryMs),
      clock.setInterval(() => {
        this.purge()
        this.recover()
        void this.flushNow()
      }, this.opts.purgeEveryMs),
    )
    this.purge()
    this.recover()
  }

  stop(): void {
    for (const off of this.offs) off()
    for (const cancel of this.cancels) cancel()
    this.offs = []
    this.cancels = []
  }

  /** Prefilters a closed episode; queues it or marks it done. */
  enqueue(episode: Episode): PrefilterResult {
    // Closed as already done (a coding agent session): nothing to learn, no LLM call.
    if (episode.extracted) return { pass: false, score: 0, cleanChars: 0, reasons: ['extracted'] }
    const result = prefilter(episode, this.opts.prefilter)
    if (!result.pass) {
      this.markExtracted(episode.id)
      return result
    }
    if (this.inFlight.has(episode.id) || this.queue.some((i) => i.episode.id === episode.id))
      return result
    const urgent =
      (episode.kind === 'ai_chat' && this.sessionActive) ||
      (episode.signals.highlights?.length ?? 0) > 0
    this.queue.push({ episode, score: result.score, urgent, attempts: 0, seq: this.seq++ })
    if (this.queue.length > this.opts.maxQueue) {
      this.sortQueue()
      this.queue.length = this.opts.maxQueue // lowest priority stays unextracted in the DB
    }
    if (urgent) void this.flushNow()
    return result
  }

  /** Sends everything queued now (within budget). Resolves when the queue is drained. */
  flushNow(): Promise<void> {
    if (this.running) {
      this.again = true
      return this.running
    }
    this.running = (async () => {
      do {
        this.again = false
        await this.drain()
      } while (this.again)
    })().finally(() => {
      this.running = null
    })
    return this.running
  }

  /** Blanks episode text older than the retention window; returns how many were purged. */
  purge(): number {
    const hours = this.deps.repos.settings.get().privacy.episodeRetentionHours
    const cutoff = new Date(this.deps.clock.now() - hours * HOUR).toISOString()
    this.queue = this.queue.filter((i) => i.episode.endedAt >= cutoff)
    try {
      return this.deps.repos.episodes.purgeTextOlderThan(cutoff)
    } catch (error) {
      this.deps.log?.('[perception] purge failed', error)
      return 0
    }
  }

  private recover(): void {
    try {
      for (const episode of this.deps.repos.episodes.listUnextracted(100)) this.enqueue(episode)
    } catch (error) {
      this.deps.log?.('[perception] could not load pending episodes', error)
    }
  }

  private async drain(): Promise<void> {
    while (this.queue.length > 0) {
      const batch = this.takeBatch()
      if (!batch) return
      // A failed call usually means the providers are down or limited: retry at the next flush.
      if (!(await this.run(batch))) return
    }
  }

  private sortQueue(): void {
    this.queue.sort(
      (a, b) => Number(b.urgent) - Number(a.urgent) || b.score - a.score || a.seq - b.seq,
    )
  }

  private takeBatch(): QueueItem[] | null {
    this.sortQueue()
    const items: QueueItem[] = []
    let tokens = PROMPT_OVERHEAD_TOKENS
    for (const item of this.queue) {
      if (items.length >= this.opts.maxBatch) break
      const t = estimateTokens(this.clip(item.episode))
      if (items.length > 0 && tokens + t > this.opts.maxBatchTokens) continue
      items.push(item)
      tokens += t
    }
    if (!this.budget.canSpend(tokens, this.deps.clock.now())) {
      if (!this.budgetWarned) this.deps.log?.('[perception] daily extraction budget reached')
      this.budgetWarned = true
      return null
    }
    this.budgetWarned = false
    this.queue = this.queue.filter((i) => !items.includes(i))
    this.budget.spend(tokens, this.deps.clock.now())
    return items
  }

  /** Returns false when the LLM call failed (the items are re-queued up to maxAttempts). */
  private async run(items: QueueItem[]): Promise<boolean> {
    const episodes = items.map((i) => i.episode)
    for (const e of episodes) this.inFlight.add(e.id)
    try {
      return await this.extractAndApply(items, episodes)
    } finally {
      for (const e of episodes) this.inFlight.delete(e.id)
    }
  }

  private async extractAndApply(items: QueueItem[], episodes: Episode[]): Promise<boolean> {
    const { brain, repos, clock } = this.deps
    let output: ExtractOutput
    try {
      const raw = await brain.extract(this.buildInput(episodes), { timeoutMs: this.opts.timeoutMs })
      output = ExtractOutput.parse(raw)
    } catch (error) {
      this.deps.log?.('[perception] extraction failed', error)
      for (const item of items) {
        item.attempts++
        if (item.attempts < this.opts.maxAttempts) this.queue.push(item)
      }
      return false
    }
    let outcome: ApplyOutcome
    try {
      outcome = repos.transaction(() => {
        const result = applyExtraction(output, episodes, repos, {
          mastery: this.deps.mastery,
          prompts: this.prompts,
          nowIso: clock.nowIso(),
        })
        for (const e of episodes) this.markExtracted(e.id)
        return result
      })
    } catch (error) {
      this.deps.log?.('[perception] could not store extraction results', error)
      return true
    }
    this.announce(outcome)
    return true
  }

  private buildInput(episodes: readonly Episode[]): ExtractInput {
    const { repos } = this.deps
    const profile = repos.profile.get()
    const mask = repos.settings.get().privacy.redact
    let treeBudget = MAX_TREE_CONCEPTS
    const subjects = repos.subjects
      .list({ status: ['active', 'suggested'] })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
      .map((s) => {
        const all = repos.concepts.listBySubject(s.id)
        const tree = conceptTree(repos, s.id, all, Math.min(MAX_SUBJECT_CONCEPTS, treeBudget))
        treeBudget -= tree.length
        return {
          id: s.id,
          name: s.name,
          topConcepts: [...all]
            .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))
            .slice(0, 6)
            .map((c) => c.name),
          ...(tree.length ? { concepts: tree } : {}),
        }
      })
    return {
      student: { aboutMe: profile.aboutMe, language: profile.promptLanguage },
      subjects,
      episodes: episodes.map((e) => ({
        id: e.id,
        app: e.app,
        url: e.url,
        title: e.title,
        kind: e.kind,
        aiProvider: e.aiProvider,
        dwellSeconds: e.dwellSeconds,
        signals: e.signals,
        text: mask ? redact(this.clip(e)) : this.clip(e),
      })),
    }
  }

  /** Long chats keep their latest part, long pages their beginning. */
  private clip(e: Episode): string {
    const max = this.opts.maxEpisodeChars
    if (e.text.length <= max) return e.text
    return e.kind === 'ai_chat' ? e.text.slice(-max) : e.text.slice(0, max)
  }

  private markExtracted(id: string): void {
    try {
      this.deps.repos.episodes.markExtracted(id)
    } catch {
      // not stored (too short / failed save): nothing to mark
    }
  }

  private announce(outcome: ApplyOutcome): void {
    const emit = (scope: MemoryChanged['scope'], ids: string[]) => {
      if (ids.length > 0 || scope === 'profile')
        this.deps.bus.emit('memory:changed', { scope, ids })
    }
    emit('inbox', outcome.encounterIds)
    emit('subjects', outcome.subjectIds)
    emit('concepts', outcome.conceptIds)
    emit('assignments', outcome.assignmentIds)
    if (outcome.profileChanged) emit('profile', [])
    for (const p of outcome.episodeSubjects) this.deps.onEpisodeSubject?.(p.episodeId, p.subjectId)
  }
}

/** Concepts listed for note placement: per subject, and across all subjects of one call. */
const MAX_SUBJECT_CONCEPTS = 60
const MAX_TREE_CONCEPTS = 150

/**
 * A subject's concept tree for P1, compact: the most recently seen and most used concepts first
 * (up to `max`), plus their ancestors so every listed parent is there, in creation order.
 */
export function conceptTree(
  repos: Repos,
  subjectId: string,
  all: readonly Concept[],
  max: number,
): { id: string; name: string; parentId: string | null }[] {
  if (max <= 0 || all.length === 0) return []
  const uses = new Map<string, number>()
  for (const e of repos.encounters.list({ subjectId, limit: 300 }))
    if (e.conceptId) uses.set(e.conceptId, (uses.get(e.conceptId) ?? 0) + 1)
  const ranked = [...all].sort(
    (a, b) =>
      (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') ||
      (uses.get(b.id) ?? 0) - (uses.get(a.id) ?? 0),
  )
  const byId = new Map(all.map((c) => [c.id, c]))
  const keep = new Set<string>()
  for (const c of ranked) {
    const chain: string[] = []
    for (let x: Concept | undefined = c; x && !keep.has(x.id); x = byId.get(x.parentId ?? ''))
      chain.push(x.id)
    if (keep.size + chain.length > max) continue
    for (const id of chain) keep.add(id)
    if (keep.size >= max) break
  }
  return all
    .filter((c) => keep.has(c.id))
    .map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId && keep.has(c.parentId) ? c.parentId : null,
    }))
}
