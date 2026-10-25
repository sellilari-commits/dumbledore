/**
 * Extraction worker (docs/PLAN.md §5.3 F1 steps 4–6, §6.4 "Extraction queue", "Retention").
 *
 * Batched decision (Ilari, 2026-10-24): closed episodes pass the local pre-gate (prefilter.ts: hard
 * rules and obvious noise) or are marked done without an LLM call (episodes that arrive already
 * done, coding agent sessions, are skipped outright). The rest are judged fast (Ilari: a page
 * should show in the side panel within 5–30 s): about 5 s after the last episode arrived (at most
 * 20 s after the first waiting one), or at once for something urgent (a highlight, an AI chat
 * during a study session). One cheap triage call (P0) judges what arrived together — with up to
 * three episodes judged in the last 5 minutes added as neighbours, their answers unused — then
 * "no" episodes are done and "yes" episodes go straight on to `Brain.extract` (P1) in batches (≤ 3
 * episodes or a token cap), with the titles of everything open in the last 5 minutes as context.
 * After a failed P1 call the queue waits retryAfterFailMs before trying again. Highlighted episodes skip triage (always yes); if triage fails, the old prefilter score
 * decides. A daily budget caps calls (triage included) and tokens, sized for a whole day of use. Results are applied through Repos (./apply), episodes are
 * marked extracted and 'memory:changed' is emitted. Hourly, episode text past the retention window
 * is purged and episodes still unextracted in the DB (queue overflow, a provider outage that used
 * up their attempts, yesterday's budget) are queued again, so nothing waits for an app restart.
 */
import type { Concept, Episode } from '@shared/domain'
import type { MemoryChanged } from '@shared/state'
import {
  type Brain,
  type ExtractInput,
  ExtractOutput,
  type TriageInput,
} from '../../brain-contract'
import type { Cancel, Clock } from '../../clock'
import type { MasteryModel, Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import { redact } from '../../privacy/redact'
import { isCodingApp, isCodingSite } from '../ai-chat/coding'
import { HOUR, MINUTE } from '../types'
import {
  type ApplyOutcome,
  activateSuggestedSubjects,
  applyExtraction,
  PromptMemory,
} from './apply'
import { DailyBudget, estimateTokens } from './budget'
import {
  cleanEpisodeText,
  type PrefilterOptions,
  type PrefilterResult,
  prefilter,
} from './prefilter'
import { scrubChanged, scrubStoredSecrets } from './scrub-secrets'

export interface WorkerOptions {
  maxBatch: number
  maxBatchTokens: number
  maxEpisodeChars: number
  /** How often the worker looks whether waiting episodes are due. */
  flushEveryMs: number
  /** Judge once no new episode arrived for this long… */
  debounceMs: number
  /** …or once the oldest waiting episode has waited this long. */
  maxWaitMs: number
  /** Judged episodes this recent are neighbours (triage) and context titles (P1). */
  contextMs: number
  /** Pause after a failed P1 call before the queue is tried again. */
  retryAfterFailMs: number
  /** Episodes per triage call (bigger windows take more calls). */
  maxTriage: number
  /** Characters of cleaned text per episode in the triage list. */
  triageExcerptChars: number
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
  flushEveryMs: 1000,
  debounceMs: 5000,
  maxWaitMs: 20_000,
  contextMs: 5 * MINUTE,
  retryAfterFailMs: 30_000,
  maxTriage: 20,
  triageExcerptChars: 300,
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
  brain: Pick<Brain, 'extract' | 'triage'>
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
  /** The prefilter's score decision: the fallback when triage fails. */
  pass: boolean
  /** Triage answer (highlights: true from the start); undefined = not judged yet. */
  decision?: boolean
  urgent: boolean
  attempts: number
  seq: number
  enqueuedAt: number
}

const PROMPT_OVERHEAD_TOKENS = 600
const TRIAGE_OVERHEAD_TOKENS = 450
const TRIAGE_TOKENS_PER_EPISODE = 40
const MAX_CONTEXT_TITLES = 8
const MAX_NEIGHBOURS = 3
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
  private lastEnqueuedAt = 0
  private retryAt = 0
  /** Episodes judged in the last contextMs: neighbours for triage, titles for P1. */
  private recent: { episode: Episode; at: number }[] = []

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
      clock.setInterval(() => void this.flushIfDue(), this.opts.flushEveryMs),
      clock.setInterval(() => {
        this.purge()
        this.recover()
        void this.flushNow()
      }, this.opts.purgeEveryMs),
    )
    this.scrubSecrets()
    this.purge()
    this.recover()
    this.activateSuggested()
  }

  /** Masks secrets already stored and drops what came from secret files' windows. */
  private scrubSecrets(): void {
    try {
      const report = scrubStoredSecrets(this.deps.repos)
      if (!scrubChanged(report)) return
      this.deps.log?.(`[perception] scrubbed stored secrets: ${JSON.stringify(report)}`)
      this.deps.bus.emit('memory:changed', { scope: 'inbox', ids: [] })
    } catch (error) {
      this.deps.log?.('[perception] could not scrub stored secrets', error)
    }
  }

  /** Subjects from before "subjects come straight from structuring": active once they hold content. */
  private activateSuggested(): void {
    try {
      const ids = this.deps.repos.transaction(() => activateSuggestedSubjects(this.deps.repos))
      if (ids.length > 0) this.deps.bus.emit('memory:changed', { scope: 'subjects', ids })
    } catch (error) {
      this.deps.log?.('[perception] could not activate suggested subjects', error)
    }
  }

  stop(): void {
    for (const off of this.offs) off()
    for (const cancel of this.cancels) cancel()
    this.offs = []
    this.cancels = []
  }

  /** Pre-gates a closed episode; adds it to the window or marks it done. */
  enqueue(episode: Episode): PrefilterResult {
    // Closed as already done (a coding agent session): nothing to learn, no LLM call.
    if (episode.extracted)
      return { gate: false, pass: false, score: 0, cleanChars: 0, reasons: ['extracted'] }
    const result = prefilter(episode, this.opts.prefilter)
    if (!result.gate) {
      this.markExtracted(episode.id)
      return result
    }
    if (this.inFlight.has(episode.id) || this.queue.some((i) => i.episode.id === episode.id))
      return result
    const highlighted = (episode.signals.highlights?.length ?? 0) > 0
    const urgent = (episode.kind === 'ai_chat' && this.sessionActive) || highlighted
    // A highlight always counts — except in a chat app that also runs coding agents, where the
    // selection may be the student's own build work: triage judges those.
    const surelyNote = highlighted && !agentCapableChat(episode)
    this.queue.push({
      episode,
      score: result.score,
      pass: result.pass,
      ...(surelyNote ? { decision: true } : {}),
      urgent,
      attempts: 0,
      seq: this.seq++,
      enqueuedAt: this.deps.clock.now(),
    })
    this.lastEnqueuedAt = this.deps.clock.now()
    if (this.queue.length > this.opts.maxQueue) {
      this.sortQueue()
      this.queue.length = this.opts.maxQueue // lowest priority stays unextracted in the DB
    }
    if (urgent) void this.flushNow()
    return result
  }

  /**
   * Judges waiting episodes when due: one is urgent, none arrived for debounceMs, or the oldest
   * waited maxWaitMs. After a failed P1 call, nothing is due until retryAfterFailMs has passed.
   */
  flushIfDue(): Promise<void> {
    const now = this.deps.clock.now()
    const idle = Promise.resolve()
    if (this.queue.length === 0 || now < this.retryAt) return this.running ?? idle
    const due =
      this.queue.some((i) => i.urgent) ||
      now - this.lastEnqueuedAt >= this.opts.debounceMs ||
      this.queue.some((i) => now - i.enqueuedAt >= this.opts.maxWaitMs)
    return due ? this.flushNow() : (this.running ?? idle)
  }

  /** Judges and extracts everything queued now (within budget). Resolves when drained. */
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

  /**
   * Blanks episode text older than the retention window; returns how many were purged.
   * A retention of 0 (the default) keeps screen text forever.
   */
  purge(): number {
    const hours = this.deps.repos.settings.get().privacy.episodeRetentionHours
    if (hours <= 0) return 0
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
    // 1. Triage: one cheap call judges the window's undecided episodes together.
    if (!(await this.triage())) return
    // What was judged now and in the last few minutes: "no" episodes still tell P1 what was open.
    this.remember(this.queue.filter((i) => i.decision !== undefined).map((i) => i.episode))
    const window = this.recent.map((r) => r.episode)
    // 2. "No": done without a P1 call. (Episodes that arrived meanwhile stay for their turn.)
    for (const item of this.queue.filter((i) => i.decision === false))
      this.markExtracted(item.episode.id)
    this.queue = this.queue.filter((i) => i.decision !== false)
    // 3. "Yes": full extraction, the window's other episodes as context.
    while (this.queue.some((i) => i.decision === true)) {
      const batch = this.takeBatch()
      if (!batch) return
      const ids = new Set(batch.map((i) => i.episode.id))
      const context = contextTitles(window.filter((e) => !ids.has(e.id)))
      // A failed call usually means the providers are down or limited: retry at the next flush.
      if (!(await this.run(batch, context))) {
        this.retryAt = this.deps.clock.now() + this.opts.retryAfterFailMs
        return
      }
    }
  }

  /** Keeps judged episodes of the last contextMs (newest last), without duplicates. */
  private remember(episodes: readonly Episode[]): void {
    const now = this.deps.clock.now()
    const ids = new Set(episodes.map((e) => e.id))
    this.recent = [
      ...this.recent.filter((r) => !ids.has(r.episode.id) && now - r.at < this.opts.contextMs),
      ...episodes.map((episode) => ({ episode, at: now })),
    ]
  }

  /** Decides every undecided item; false when the budget is used up (they stay queued). */
  private async triage(): Promise<boolean> {
    const { brain, clock } = this.deps
    while (true) {
      const items = this.queue
        .filter((i) => i.decision === undefined && !this.inFlight.has(i.episode.id))
        .slice(0, this.opts.maxTriage)
      if (items.length === 0) return true
      // Recently judged episodes ride along as neighbours, so related pages are judged together.
      const ids = new Set(items.map((i) => i.episode.id))
      const neighbours = this.recent
        .filter((r) => !ids.has(r.episode.id) && clock.now() - r.at < this.opts.contextMs)
        .slice(-MAX_NEIGHBOURS)
        .map((r) => r.episode)
      const input = this.triageInput([...neighbours, ...items.map((i) => i.episode)])
      const tokens =
        TRIAGE_OVERHEAD_TOKENS +
        input.episodes.length * TRIAGE_TOKENS_PER_EPISODE +
        estimateTokens(input.episodes.map((e) => e.excerpt).join('\n'))
      if (!this.budget.canSpend(tokens, clock.now())) {
        if (!this.budgetWarned) this.deps.log?.('[perception] daily extraction budget reached')
        this.budgetWarned = true
        return false
      }
      this.budget.spend(tokens, clock.now())
      let answers = new Map<string, boolean | null>()
      try {
        const out = await brain.triage(input, { timeoutMs: this.opts.timeoutMs })
        answers = new Map(out.results.map((r) => [r.id, r.hasLearnableContent]))
      } catch (error) {
        this.deps.log?.('[perception] triage failed; using the prefilter score', error)
      }
      for (const item of items) item.decision = answers.get(item.episode.id) ?? item.pass
    }
  }

  private triageInput(episodes: readonly Episode[]): TriageInput {
    const mask = this.deps.repos.settings.get().privacy.redact
    const max = this.opts.triageExcerptChars
    return {
      language: this.deps.repos.profile.get().promptLanguage,
      episodes: episodes.map((e) => {
        const clean = cleanEpisodeText(mask ? redact(this.clip(e)) : this.clip(e))
        // A chat's latest turns say most; a page's beginning does.
        const excerpt = e.kind === 'ai_chat' ? clean.slice(-max) : clean.slice(0, max)
        return {
          id: e.id,
          kind: e.kind,
          app: e.app,
          title: e.title,
          url: e.url,
          dwellSeconds: e.dwellSeconds,
          signals: e.signals,
          excerpt,
        }
      }),
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
      if (item.decision !== true) continue
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
  private async run(items: QueueItem[], context: string[] = []): Promise<boolean> {
    const episodes = items.map((i) => i.episode)
    for (const e of episodes) this.inFlight.add(e.id)
    try {
      return await this.extractAndApply(items, episodes, context)
    } finally {
      for (const e of episodes) this.inFlight.delete(e.id)
    }
  }

  private async extractAndApply(
    items: QueueItem[],
    episodes: Episode[],
    context: string[],
  ): Promise<boolean> {
    const { brain, repos, clock } = this.deps
    let output: ExtractOutput
    try {
      const raw = await brain.extract(this.buildInput(episodes, context), {
        timeoutMs: this.opts.timeoutMs,
      })
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

  private buildInput(episodes: readonly Episode[], context: string[] = []): ExtractInput {
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
      ...(context.length ? { context } : {}),
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

/** Chat apps and sites that also run coding agents (Claude's Code tab, ChatGPT's Codex). */
const AGENT_CHAT_BUNDLES = new Set([
  'com.anthropic.claudefordesktop',
  'com.openai.codex',
  'com.openai.chat',
])

function agentCapableChat(e: Episode): boolean {
  return (
    e.kind === 'ai_chat' &&
    (AGENT_CHAT_BUNDLES.has(e.bundleId) || isCodingApp(e.bundleId) || isCodingSite(e.url))
  )
}

/** "Tampere – Wikipedia (reading)", newest last, deduped, for P1's <context>. */
export function contextTitles(episodes: readonly Episode[]): string[] {
  const out: string[] = []
  for (const e of episodes) {
    const title = `${(e.title ?? e.app).slice(0, 80)} (${e.kind === 'ai_chat' ? 'AI chat' : e.kind})`
    if (!out.includes(title)) out.push(title)
  }
  return out.slice(-MAX_CONTEXT_TITLES)
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
