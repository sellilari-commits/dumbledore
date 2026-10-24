/**
 * One open episode: merged text, dwell, scroll tracking and the conversion into a stored
 * `Episode` when it closes (or hits a rolling checkpoint and continues as a new segment).
 */
import type { Episode, EpisodeKind } from '@shared/domain'
import type { TextLine } from '@shared/helper-protocol'
import { newId } from '../../ids'
import { redact } from '../../privacy/redact'
import { hostOf } from '../../privacy/url'
import { ASSISTANTS, GENERIC_CHAT_MARKERS } from '../ai-chat/assistants'
import { MINUTE, SECOND } from '../types'
import { BoilerplateStripper } from './boilerplate'
import { isPdf, isReadingApp } from './keys'
import { type FrameLine, type MergedLine, MergedText } from './merged-text'
import { type ReadingBaseline, ScrollTracker, type SearchLog, studentMessages } from './signals'
import { pickNewLines, type StoredLines } from './stored-lines'
import { cleanLine, isUiNoise, lineKey, wordCount } from './text'

export interface EpisodeEnv {
  boilerplate: BoilerplateStripper
  /** Lines already stored per page. */
  stored: StoredLines
  baseline: ReadingBaseline
  searches: SearchLog
  minPersistDwellS: number
  maxTextChars: number
}

export interface OpenEpisodeInit {
  pid: number
  key: string
  windowKey: string
  pageKey: string
  bundleId: string
  app: string
  title: string | null
  url: string | null
  aiProvider: string | null
  userAlign: 'right' | null
  at: number
  revisitsToday: number
}

/** Chat UI strings (placeholders, disclaimers) are chrome inside AI-chat episodes. */
const CHAT_CHROME = new Set(
  [
    ...GENERIC_CHAT_MARKERS,
    ...ASSISTANTS.flatMap((a) => [...a.textMarkers, ...a.placeholders]),
  ].map(lineKey),
)
const CHAT_DISCLAIMER = /\b(can make mistakes|may display inaccurate|for reference only)\b/i

const SEARCH_LOOKBACK_MS = 5 * MINUTE
const TAG = { left: '[L] ', center: '[C] ', right: '[R] ' } as const

export class OpenEpisode {
  id = newId('epi')
  key: string
  windowKey: string
  pageKey: string
  readonly pid: number
  readonly bundleId: string
  readonly app: string
  title: string | null
  url: string | null
  aiProvider: string | null
  /** Opened when this window stopped being an AI chat (a coding session took over). */
  leftChat = false
  /**
   * A coding agent session was on screen (the Claude app's Code tab): the episode is kept for
   * time and context but stored as already extracted, so no study memory comes from it.
   */
  agentSession = false
  userAlign: 'right' | null
  readonly visitStartedAt: number
  readonly revisitsToday: number
  startedAt: number
  segment = 0
  dwellMs = 0
  visitDwellMs = 0
  isFront = false
  lastFrontAt: number | null = null
  lastVisibleAt: number | null = null
  leftAt: number | null = null
  lastActiveAt: number
  words = 0
  frames = 0
  readonly merged = new MergedText()
  private scroll = new ScrollTracker()
  private sources = new Set<'ax' | 'ocr'>()
  private lastSource: 'ax' | 'ocr' | null = null
  viewport: string[] = []
  /** Text the student selected in this segment (perception/highlights.ts). */
  highlights: string[] = []
  private lastHighlight: string | null = null

  constructor(init: OpenEpisodeInit) {
    this.key = init.key
    this.windowKey = init.windowKey
    this.pageKey = init.pageKey
    this.pid = init.pid
    this.bundleId = init.bundleId
    this.app = init.app
    this.title = init.title
    this.url = init.url
    this.aiProvider = init.aiProvider
    this.userAlign = init.userAlign
    this.visitStartedAt = init.at
    this.startedAt = init.at
    this.lastActiveAt = init.at
    this.revisitsToday = init.revisitsToday
  }

  get scopes(): string[] {
    return BoilerplateStripper.scopesFor(this.bundleId, hostOf(this.url))
  }

  addDwell(ms: number): void {
    if (ms <= 0) return
    this.dwellMs += ms
    this.visitDwellMs += ms
  }

  /** Records a highlight; false when it repeats the last one saved for this page. */
  addHighlight(text: string): boolean {
    if (text === this.lastHighlight) return false
    this.lastHighlight = text
    this.highlights.push(text)
    return true
  }

  /** Cleans, masks and merges one changed frame; returns the frame lines as stored. */
  addLines(
    lines: readonly TextLine[],
    source: 'ax' | 'ocr',
    mask: boolean,
    env: EpisodeEnv,
  ): FrameLine[] {
    const frame: FrameLine[] = []
    for (const l of lines) {
      const text = cleanLine(l.text, source === 'ocr')
      if (!text) continue
      frame.push({ text: mask ? redact(text) : text, align: l.align })
    }
    if (frame.length === 0) return frame
    this.sources.add(source)
    this.frames++
    this.lastSource = source
    const result = this.merged.addFrame(frame, this.segment)
    for (const line of result.added) this.words += wordCount(line.text)
    const keys = [...new Set(frame.map((l) => lineKey(l.text)).filter(Boolean))]
    this.scroll.observe(this.viewport, keys, (k) => this.merged.firstSeen(k))
    this.viewport = keys
    env.boilerplate.observe(this.scopes, this.pageKey, new Set(this.viewport))
    return frame
  }

  /** Lines worth keeping: not chrome, not boilerplate, optionally only from this segment. */
  contentLines(env: EpisodeEnv, segmentOnly: boolean): MergedLine[] {
    const scopes = this.scopes
    return this.merged
      .all()
      .filter(
        (l) =>
          (!segmentOnly || l.segment === this.segment) &&
          !isUiNoise(l.text) &&
          !(this.aiProvider && (CHAT_CHROME.has(l.key) || CHAT_DISCLAIMER.test(l.text))) &&
          !env.boilerplate.isBoilerplate(scopes, l.key),
      )
  }

  kindGuess(lines?: readonly MergedLine[]): EpisodeKind {
    if (this.aiProvider) return 'ai_chat'
    if (this.agentSession) return 'other' // a coding agent's transcript is not reading
    if (isReadingApp(this.bundleId) || isPdf(this.url, this.title)) return 'reading'
    const count = lines ? lines.length : this.merged.size
    const words = lines ? lines.reduce((n, l) => n + wordCount(l.text), 0) : this.words
    return words >= 120 && words / Math.max(1, count) >= 6 ? 'reading' : 'other'
  }

  /** The stored form of this segment, or null when it is too short or empty to keep. */
  finalize(endedAt: number, env: EpisodeEnv): Episode | null {
    const lines = this.contentLines(env, true)
    const kind = this.kindGuess(lines)
    const tagged = kind === 'ai_chat'
    const highlights = [...this.highlights]
    // Only lines not yet stored for this page (plus a little context): a short scroll, a
    // checkpoint or a revisit does not store the same text again (stored-lines.ts).
    const picked = pickNewLines(
      lines,
      env.stored.get(this.pageKey),
      highlights,
      tagged ? this.userAlign : null,
    )
    let text = ''
    const saved: string[] = []
    for (const l of picked.kept) {
      const line = (tagged && l.align ? TAG[l.align] : '') + l.text
      if (text && text.length + 1 + line.length > env.maxTextChars) break
      text = text ? `${text}\n${line}` : line.slice(0, env.maxTextChars)
      saved.push(l.key)
    }
    const dwellSeconds = Math.round(this.dwellMs / SECOND)
    // A highlight is a note the student chose to keep: it is stored however short the visit.
    if (highlights.length === 0 && (dwellSeconds < env.minPersistDwellS || !text.trim()))
      return null
    if (!text.trim()) text = highlights.join('\n')
    env.stored.add(this.pageKey, saved)
    // Nothing new on a revisit: kept for dwell and visit history, but no LLM call is spent on it.
    const nothingNew = picked.fresh === 0 && highlights.length === 0

    const words = lines.reduce((n, l) => n + wordCount(l.text), 0)
    const readingWpm =
      kind === 'reading' && dwellSeconds >= 20 ? Math.round(words / (dwellSeconds / 60)) : null
    const baselineWpm = env.baseline.value
    if (readingWpm !== null) env.baseline.update(readingWpm)

    return {
      id: this.id,
      bundleId: this.bundleId,
      app: this.app,
      title: this.title,
      url: this.url,
      kind,
      aiProvider: this.aiProvider,
      startedAt: new Date(this.startedAt).toISOString(),
      endedAt: new Date(Math.max(endedAt, this.startedAt)).toISOString(),
      dwellSeconds,
      text,
      source: this.sources.size > 1 ? 'mixed' : this.sources.has('ocr') ? 'ocr' : 'ax',
      signals: {
        readingWpm,
        baselineWpm,
        scrollBacks: this.scroll.backs,
        revisitsToday: this.revisitsToday,
        searches: env.searches.between(this.visitStartedAt - SEARCH_LOOKBACK_MS, endedAt),
        aiQuestions: kind === 'ai_chat' ? studentMessages(lines, this.userAlign) : [],
        highlights,
      },
      // A coding agent's session is work, not study: done, even with a selection in it.
      extracted: this.agentSession || nothingNew,
    }
  }

  /** Rolling checkpoint: continue the same page as a new segment with a new id. */
  startNextSegment(at: number): void {
    this.id = newId('epi')
    this.segment++
    this.startedAt = at
    this.dwellMs = 0
    this.highlights = []
    this.scroll = new ScrollTracker()
    this.sources = new Set(this.lastSource ? [this.lastSource] : [])
    this.merged.touch(this.viewport, this.segment)
  }
}
