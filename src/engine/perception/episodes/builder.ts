/**
 * Episode builder (docs/PLAN.md §5.3 F1, §6.4): turns perceive batches into episodes.
 *
 * Frames are grouped per app + window + page. Dwell counts only while a window is in front (or,
 * for side-by-side windows, while its content changes). An episode closes 8 s after the student
 * switched away, when capture pauses (idle, lock, switch off), or every 3 min as a rolling
 * checkpoint for long reads (the page continues as a new segment). It also keeps "Right now".
 */
import type { Episode } from '@shared/domain'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { NowContext } from '@shared/state'
import type { AssistantMatch } from '../ai-chat/detector'
import type { PerceiveBatch } from '../scheduler'
import { MINUTE, SECOND, type WindowLike } from '../types'
import { BoilerplateStripper } from './boilerplate'
import { continuesChat, episodeKeyOf } from './keys'
import { type EpisodeEnv, OpenEpisode } from './open-episode'
import { parseSearchQuery, ReadingBaseline, SearchLog, VisitLog } from './signals'

export interface EpisodeOptions {
  switchCloseMs: number
  checkpointMs: number
  maxDwellStepMs: number
  idleDwellCapSeconds: number
  minPersistDwellS: number
  maxTextChars: number
  maxOpen: number
}

export const EPISODE_DEFAULTS: EpisodeOptions = {
  switchCloseMs: 8 * SECOND,
  checkpointMs: 3 * MINUTE,
  maxDwellStepMs: 15 * SECOND,
  idleDwellCapSeconds: 120,
  minPersistDwellS: 5,
  maxTextChars: 20_000,
  maxOpen: 8,
}

/** What the context helpers need from a page after its episode closed. */
export interface PageSnapshot {
  episode: OpenEpisode
  at: number
}

export interface EpisodeBuilderDeps {
  classify: (win: WindowLike) => AssistantMatch | null
  /** After classify: the window shows a coding agent session (the Claude app's Code tab). */
  isAgentSession?: (win: WindowLike) => boolean
  /** Mask secrets/personal data at capture (settings.privacy.redact). */
  redact: () => boolean
  onClose: (episode: Episode, pageKey: string) => void
  onFrame?: (win: PerceivedWindow) => void
  onNow?: (now: NowContext | null) => void
  subjectFor?: (pageKey: string) => string | null
  baseline?: ReadingBaseline
  visits?: VisitLog
  searches?: SearchLog
  boilerplate?: BoilerplateStripper
  options?: Partial<EpisodeOptions>
}

export class EpisodeBuilder {
  readonly env: EpisodeEnv
  readonly visits: VisitLog
  private readonly opts: EpisodeOptions
  private readonly open = new Map<string, OpenEpisode>()
  private front: OpenEpisode | null = null
  private lastNow: NowContext | null = null
  private lastChat: PageSnapshot | null = null
  private lastPage: PageSnapshot | null = null

  constructor(private readonly deps: EpisodeBuilderDeps) {
    this.opts = { ...EPISODE_DEFAULTS, ...deps.options }
    this.visits = deps.visits ?? new VisitLog()
    this.env = {
      boilerplate: deps.boilerplate ?? new BoilerplateStripper(),
      baseline: deps.baseline ?? new ReadingBaseline(),
      searches: deps.searches ?? new SearchLog(),
      minPersistDwellS: this.opts.minPersistDwellS,
      maxTextChars: this.opts.maxTextChars,
    }
  }

  ingest(batch: PerceiveBatch): void {
    const { at, idleSeconds } = batch
    const front = batch.front ? this.observe(batch.front, at, idleSeconds, true) : null
    for (const ep of this.open.values()) {
      if (ep !== front && ep.isFront) {
        ep.isFront = false
        ep.leftAt ??= at
      }
    }
    this.front = front
    if (batch.visible) {
      const seen = new Set<OpenEpisode>()
      for (const w of batch.visible) seen.add(this.observe(w, at, idleSeconds, false))
      for (const ep of this.open.values()) {
        if (!ep.isFront && !seen.has(ep)) ep.leftAt ??= at
      }
    }
    for (const ep of [...this.open.values()]) {
      if (ep.leftAt !== null && at - ep.leftAt >= this.opts.switchCloseMs) this.close(ep, ep.leftAt)
      else if (at - ep.startedAt >= this.opts.checkpointMs) this.checkpoint(ep, at)
    }
    this.emitNow()
  }

  /** Capture paused or stopped: close everything at the last moment of activity. */
  closeAll(): void {
    for (const ep of [...this.open.values()]) this.close(ep, ep.lastActiveAt)
    this.front = null
    this.emitNow()
  }

  current(): OpenEpisode | null {
    return this.front
  }

  /** Closes the current segment of matching episodes now; they continue as new segments. */
  checkpointNow(filter: (ep: OpenEpisode) => boolean, at: number): number {
    let n = 0
    for (const ep of [...this.open.values()]) {
      if (!filter(ep)) continue
      this.checkpoint(ep, at)
      n++
    }
    return n
  }

  /** The AI chat to read from: an open chat episode (preferring `pid`), else the last closed one. */
  chatSource(pid?: number | null): OpenEpisode | null {
    const chats = [...this.open.values()].filter((e) => e.aiProvider)
    const pick =
      chats.find((e) => pid != null && e.pid === pid) ?? chats.find((e) => e.isFront) ?? chats[0]
    return pick ?? this.lastChat?.episode ?? null
  }

  /** The frontmost non-chat page, or the last one seen. */
  pageSource(): OpenEpisode | null {
    if (this.front && !this.front.aiProvider) return this.front
    const open = [...this.open.values()]
      .filter((e) => !e.aiProvider)
      .sort((a, b) => b.lastActiveAt - a.lastActiveAt)
    return open[0] ?? this.lastPage?.episode ?? null
  }

  private observe(
    win: PerceivedWindow,
    at: number,
    idleSeconds: number,
    isFront: boolean,
  ): OpenEpisode {
    const match = this.deps.classify(win)
    const agentSession = !match && (this.deps.isAgentSession?.(win) ?? false)
    const ids = episodeKeyOf(win)
    let ep = this.open.get(ids.key)
    if (!ep && match) {
      const prev = [...this.open.values()].find(
        (e) => e.windowKey === ids.windowKey && e.aiProvider && continuesChat(e.url, win.url),
      )
      if (prev) {
        this.open.delete(prev.key)
        prev.key = ids.key
        prev.pageKey = ids.pageKey
        prev.url = win.url
        this.open.set(prev.key, prev)
        ep = prev
      }
    }
    const hasText = win.changed && win.lines.length > 0
    // The same window switched between a chat and a coding session (the Claude app's Chat and
    // Code tabs): close what was read so far, so neither side's text lands in the other.
    if (ep && hasText && (ep.aiProvider ? !match : match && (ep.leftChat || ep.agentSession))) {
      const wasChat = ep.aiProvider !== null
      this.close(ep, at)
      ep = this.create(win, ids, match, at)
      ep.leftChat = wasChat
    }
    if (!ep) ep = this.create(win, ids, match, at)
    // Nothing is learned from a coding agent's session (see OpenEpisode.agentSession).
    if (agentSession && hasText) ep.agentSession = true
    if (match && !ep.aiProvider) {
      ep.aiProvider = match.assistant.key
      ep.userAlign = match.assistant.userAlign
    }
    ep.leftAt = null
    if (win.title) ep.title = win.title
    const countsTowardDwell = idleSeconds < this.opts.idleDwellCapSeconds
    if (isFront) {
      if (ep.isFront && ep.lastFrontAt !== null && countsTowardDwell) {
        ep.addDwell(Math.min(at - ep.lastFrontAt, this.opts.maxDwellStepMs))
      }
      ep.isFront = true
      ep.lastFrontAt = at
      ep.lastActiveAt = at
    } else {
      if (hasText && ep.lastVisibleAt !== null && countsTowardDwell) {
        ep.addDwell(Math.min(at - ep.lastVisibleAt, this.opts.maxDwellStepMs * 2))
        ep.lastActiveAt = at
      }
      ep.lastVisibleAt = at
    }
    if (hasText) {
      const masked = this.deps.redact()
      const lines = ep.addLines(win.lines, win.source, masked, this.env)
      this.deps.onFrame?.({
        ...win,
        lines: lines.map((l) => ({ text: l.text, conf: 1, box: null, align: l.align })),
      })
    }
    return ep
  }

  private create(
    win: PerceivedWindow,
    ids: { key: string; windowKey: string; pageKey: string },
    match: AssistantMatch | null,
    at: number,
  ): OpenEpisode {
    const search = parseSearchQuery(win.url)
    if (search) this.env.searches.record(search.query, at)
    const ep = new OpenEpisode({
      ...ids,
      pid: win.pid,
      bundleId: win.bundleId,
      app: win.appName,
      title: win.title,
      url: win.url,
      aiProvider: match?.assistant.key ?? null,
      userAlign: match?.assistant.userAlign ?? null,
      at,
      revisitsToday: this.visits.record(ids.pageKey, at),
    })
    this.open.set(ep.key, ep)
    if (this.open.size > this.opts.maxOpen) {
      const oldest = [...this.open.values()]
        .filter((e) => e !== ep && !e.isFront)
        .sort((a, b) => a.lastActiveAt - b.lastActiveAt)[0]
      if (oldest) this.close(oldest, oldest.lastActiveAt)
    }
    return ep
  }

  private close(ep: OpenEpisode, endedAt: number): void {
    this.open.delete(ep.key)
    if (this.front === ep) this.front = null
    this.remember(ep, endedAt)
    const episode = ep.finalize(endedAt, this.env)
    if (episode) this.deps.onClose(episode, ep.pageKey)
  }

  private checkpoint(ep: OpenEpisode, at: number): void {
    const episode = ep.finalize(at, this.env)
    if (episode) this.deps.onClose(episode, ep.pageKey)
    ep.startNextSegment(at)
  }

  private remember(ep: OpenEpisode, at: number): void {
    if (ep.merged.size === 0) return
    if (ep.aiProvider) this.lastChat = { episode: ep, at }
    else this.lastPage = { episode: ep, at }
  }

  private emitNow(): void {
    const ep = this.front
    const now: NowContext | null = ep
      ? {
          app: ep.app,
          title: ep.title,
          url: ep.url,
          minutes: Math.floor(ep.visitDwellMs / MINUTE),
          kind: ep.kindGuess(),
          subjectId: this.deps.subjectFor?.(ep.pageKey) ?? null,
          suggestion: null,
        }
      : null
    if (JSON.stringify(now) === JSON.stringify(this.lastNow)) return
    this.lastNow = now
    this.deps.onNow?.(now)
  }
}
