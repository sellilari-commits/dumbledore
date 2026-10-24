/**
 * PerceptionService (engine/contracts.ts): wires the capture scheduler, the privacy gate, the
 * AI-chat tracker and the episode builder to the helper, Repos and the engine bus.
 *
 * Emits 'perception:window' (masked frames), 'perception:episodeClosed', 'perception:now' and
 * 'perception:aiChat'. Listens to 'settings:changed' and the helper:* events the shell forwards
 * ('helper:focus' feeds the focused composer to the AI-chat tracker).
 */
import type { Episode, Settings } from '@shared/domain'
import type { NowContext } from '@shared/state'
import { type Clock, systemClock } from '../clock'
import type { AiChatInfo, HelperClient, PerceptionService, Repos } from '../contracts'
import type { EngineBus } from '../events'
import { assistantByKey } from './ai-chat/assistants'
import { AiChatTracker } from './ai-chat/tracker'
import { EpisodeBuilder, type EpisodeOptions } from './episodes/builder'
import { chatExcerptOf, pageContextOf } from './episodes/context'
import { pageKeyOf } from './episodes/keys'
import { CaptureScheduler } from './scheduler'

export interface PerceptionDeps {
  helper: HelperClient
  repos: Repos
  bus: EngineBus
  clock?: Clock
  /** macOS Low Power Mode (from the shell); doubles every capture interval. */
  isLowPower?: () => boolean
  log?: (message: string, error?: unknown) => void
  episodeOptions?: Partial<EpisodeOptions>
}

const DAY = 24 * 60 * 60 * 1000
const MAX_LINKS = 500

export class Perception implements PerceptionService {
  private readonly clock: Clock
  private readonly scheduler: CaptureScheduler
  private readonly tracker: AiChatTracker
  private readonly builder: EpisodeBuilder
  private settings: Settings
  private enabled = true
  private started = false
  private nowCtx: NowContext | null = null
  private offs: (() => void)[] = []
  private readonly pageOfEpisode = new Map<string, string>()
  private readonly subjectOfPage = new Map<string, string>()

  constructor(private readonly deps: PerceptionDeps) {
    this.clock = deps.clock ?? systemClock
    this.settings = deps.repos.settings.get()
    this.tracker = new AiChatTracker((chat) => deps.bus.emit('perception:aiChat', { chat }))
    this.builder = new EpisodeBuilder({
      classify: (win) => this.tracker.classify(win),
      isAgentSession: (win) => this.tracker.isAgentSession(win),
      redact: () => this.settings.privacy.redact,
      onClose: (episode, pageKey) => this.onEpisodeClosed(episode, pageKey),
      onFrame: (window) => deps.bus.emit('perception:window', { window }),
      onNow: (now) => {
        this.nowCtx = now
        deps.bus.emit('perception:now', { now })
      },
      subjectFor: (pageKey) => this.subjectOfPage.get(pageKey) ?? null,
      options: deps.episodeOptions,
    })
    this.scheduler = new CaptureScheduler({
      helper: deps.helper,
      clock: this.clock,
      settings: () => this.settings,
      isLowPower: deps.isLowPower,
      log: deps.log,
      onBatch: (batch) => {
        this.tracker.observeFrontmost(batch.front)
        if (batch.visible) this.tracker.observeVisible(batch.visible)
        this.builder.ingest(batch)
      },
      onPause: () => {
        this.builder.closeAll()
        this.tracker.reset()
      },
    })
  }

  start(): void {
    if (this.started) return
    this.started = true
    const { bus } = this.deps
    this.offs.push(
      bus.on('settings:changed', ({ settings }) => {
        this.settings = settings
        this.scheduler.refresh()
      }),
      bus.on('helper:screenLocked', ({ locked }) => this.scheduler.setLocked(locked)),
      bus.on('helper:appActivated', () => this.scheduler.poke()),
      // The composer the student focuses tells unknown AI chats apart (ai-chat/composer.ts).
      bus.on('helper:focus', ({ element }) => this.tracker.observeFocus(element)),
      bus.on('helper:status', ({ status }) => {
        if (status === 'connected') this.scheduler.poke()
      }),
    )
    this.seedHistory()
    this.scheduler.setEnabled(this.enabled)
    this.scheduler.start()
  }

  stop(): void {
    if (!this.started) return
    this.started = false
    for (const off of this.offs) off()
    this.offs = []
    this.scheduler.stop()
    this.builder.closeAll()
    this.tracker.reset()
  }

  /** The capture switch: stops reading the screen immediately when off. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.scheduler.setEnabled(enabled)
  }

  isActive(): boolean {
    return this.started && this.enabled && this.scheduler.isActive()
  }

  now(): NowContext | null {
    return this.nowCtx
  }

  aiChat(): AiChatInfo | null {
    return this.tracker.get()
  }

  chatExcerpt(maxChars: number): string {
    const chat = this.tracker.get()
    const source = this.builder.chatSource(chat?.pid ?? null)
    const name =
      chat?.assistant ??
      (source?.aiProvider ? (assistantByKey(source.aiProvider)?.name ?? null) : null)
    return chatExcerptOf(source, this.builder.env, name, maxChars)
  }

  pageContext(maxChars: number): string {
    return pageContextOf(this.builder.pageSource(), this.builder.env, maxChars)
  }

  /** Closes the open AI-chat segment now so it can be extracted (e.g. on ▸ Next). */
  checkpointChat(): boolean {
    return this.builder.checkpointNow((ep) => ep.aiProvider !== null, this.clock.now()) > 0
  }

  /** Remembers the subject an extracted episode belonged to, for "Right now". */
  linkSubject(episodeId: string, subjectId: string): void {
    const page = this.pageOfEpisode.get(episodeId)
    if (!page) return
    this.subjectOfPage.delete(page)
    this.subjectOfPage.set(page, subjectId)
    trim(this.subjectOfPage)
  }

  /** One capture tick right now (integration and tests). */
  tickNow(): Promise<void> {
    return this.scheduler.tickNow()
  }

  private onEpisodeClosed(episode: Episode, pageKey: string): void {
    this.pageOfEpisode.set(episode.id, pageKey)
    trim(this.pageOfEpisode)
    try {
      this.deps.repos.episodes.save(episode)
    } catch (error) {
      this.deps.log?.('[perception] could not save episode', error)
    }
    this.deps.bus.emit('perception:episodeClosed', { episode })
  }

  /** Seeds the reading baseline (14 days) and today's visits from stored episodes. */
  private seedHistory(): void {
    try {
      const now = this.clock.now()
      const recent = this.deps.repos.episodes.recent({
        sinceIso: new Date(now - 14 * DAY).toISOString(),
        limit: 500,
      })
      this.builder.env.baseline.seed(
        recent.map((e) => e.signals.readingWpm).filter((w): w is number => w !== null),
      )
      const midnight = new Date(now)
      midnight.setHours(0, 0, 0, 0)
      const today = recent
        .filter((e) => Date.parse(e.startedAt) >= midnight.getTime())
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
      const pages: string[] = []
      const lastEnd = new Map<string, string>()
      for (const e of today) {
        const page = pageKeyOf(e)
        if (lastEnd.get(page) !== e.startedAt) pages.push(page) // checkpoint segments are one visit
        lastEnd.set(page, e.endedAt)
      }
      this.builder.visits.seed(pages, now)
    } catch (error) {
      this.deps.log?.('[perception] could not read episode history', error)
    }
  }
}

function trim(map: Map<string, string>): void {
  while (map.size > MAX_LINKS) {
    const oldest = map.keys().next().value
    if (oldest === undefined) return
    map.delete(oldest)
  }
}
