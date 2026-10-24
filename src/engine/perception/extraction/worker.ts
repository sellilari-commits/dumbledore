/**
 * Extraction worker (docs/PLAN.md §5.3 F1 steps 4–6, §6.4 "Extraction queue", "Retention").
 *
 * Closed episodes pass the local prefilter or are marked done without an LLM call. Passing ones
 * queue up and go to `Brain.extract` in batches (≤ 3 episodes or a token cap), every 2 minutes,
 * or at once for AI-chat episodes during a study session. A daily budget caps calls and tokens.
 * Results are applied through Repos (./apply), episodes are marked extracted and
 * 'memory:changed' is emitted. Episode text past the retention window is purged hourly.
 */
import type { Episode } from '@shared/domain'
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
  dailyMaxCalls: 150,
  dailyMaxTokens: 200_000,
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
  private seq = 0
  private cancels: Cancel[] = []
  private offs: (() => void)[] = []
  private sessionActive = false
  private running: Promise<void> | null = null
  private again = false
  private budgetWarned = false

  constructor(private readonly deps: ExtractionWorkerDeps) {
    this.opts = { ...WORKER_DEFAULTS, ...deps.options }
    this.budget = new DailyBudget({ maxCalls: this.opts.dailyMaxCalls, maxTokens: this.opts.dailyMaxTokens })
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
      clock.setInterval(() => this.purge(), this.opts.purgeEveryMs),
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
    const result = prefilter(episode, this.opts.prefilter)
    if (!result.pass) {
      this.markExtracted(episode.id)
      return result
    }
    if (this.queue.some((i) => i.episode.id === episode.id)) return result
    const urgent = episode.kind === 'ai_chat' && this.sessionActive
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
    this.queue.sort((a, b) => Number(b.urgent) - Number(a.urgent) || b.score - a.score || a.seq - b.seq)
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
    const { brain, repos, clock } = this.deps
    const episodes = items.map((i) => i.episode)
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
    const subjects = repos.subjects
      .list({ status: ['active', 'suggested'] })
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, 30)
      .map((s) => ({
        id: s.id,
        name: s.name,
        topConcepts: repos.concepts
          .listBySubject(s.id)
          .sort((a, b) => (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''))
          .slice(0, 6)
          .map((c) => c.name),
      }))
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
      if (ids.length > 0 || scope === 'profile') this.deps.bus.emit('memory:changed', { scope, ids })
    }
    emit('inbox', outcome.encounterIds)
    emit('subjects', outcome.subjectIds)
    emit('concepts', outcome.conceptIds)
    emit('assignments', outcome.assignmentIds)
    if (outcome.profileChanged) emit('profile', [])
    for (const p of outcome.episodeSubjects) this.deps.onEpisodeSubject?.(p.episodeId, p.subjectId)
  }
}
