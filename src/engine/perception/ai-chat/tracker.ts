/**
 * Tracks which AI chat is open right now and reports changes ('perception:aiChat').
 *
 * The frontmost window wins. When something else is frontmost, a chat seen in the latest scan of
 * visible windows still counts (split screen: PDF + ChatGPT side by side). Detection results are
 * cached per window so unchanged frames (no lines) keep their classification; a chat stays a
 * chat while its page is open unless a coding session takes over the screen.
 *
 * Focus changes from the helper add the composer: when the student focuses a chat-like text box
 * in the frontmost window, the window is classified again with it (unknown LLM UIs, assistants
 * named by their placeholder). The composer counts for that window while it stays on the same
 * site (a new chat moving to its conversation URL keeps it).
 */
import type { FocusedElement } from '@shared/helper-protocol'
import type { AiChatInfo } from '../../contracts'
import { parseUrl } from '../../privacy/url'
import { type WindowLike, windowKey } from '../types'
import { type ComposerHint, composerOf } from './composer'
import { type AssistantMatch, detectChat } from './detector'

type Lines = WindowLike['lines']

interface CacheEntry {
  url: string | null
  title: string | null
  match: AssistantMatch | null
  /** The window shows a coding agent session (see Detection.agentSession). */
  agentSession: boolean
  composer: string
  lines: Lines
}

interface FocusHint {
  windowKey: string
  site: string | null // host, or null for apps without URLs
  composer: ComposerHint
}

const MAX_CACHE = 64

export class AiChatTracker {
  private front: AiChatInfo | null = null
  private frontWin: WindowLike | null = null
  private visible: AiChatInfo[] = []
  private current: AiChatInfo | null = null
  private hint: FocusHint | null = null
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly onChange: (chat: AiChatInfo | null) => void = () => {}) {}

  get(): AiChatInfo | null {
    return this.current
  }

  /** Classifies a window; frames without lines reuse the last result for the same page. */
  classify(win: WindowLike): AssistantMatch | null {
    const key = windowKey(win)
    const cached = this.cache.get(key)
    const composer = this.composerFor(win)
    const composerSig = composer ? `${composer.placeholder ?? ''}|${composer.multiline}` : ''
    const hasLines = (win.lines?.length ?? 0) > 0
    const sameUrl = cached !== undefined && cached.url === win.url
    const sameTitle = sameUrl && cached.title === win.title
    if (sameTitle && !hasLines && cached.composer === composerSig) return cached.match
    const lines = hasLines ? win.lines : sameUrl ? cached.lines : undefined
    const detection = detectChat({ ...win, lines }, composer)
    let match = detection.match
    // A chat keeps its classification on frames that lack its markers (scrolled, typing).
    const samePage = sameUrl && (win.url !== null || sameTitle || !hasLines)
    if (!match && !detection.coding && samePage) match = cached.match
    this.cache.delete(key)
    this.cache.set(key, {
      url: win.url,
      title: win.title,
      match,
      agentSession: detection.agentSession,
      composer: composerSig,
      lines,
    })
    if (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return match
  }

  /** Whether the window's last classification was a coding agent session (Code tab). */
  isAgentSession(win: WindowLike): boolean {
    return this.cache.get(windowKey(win))?.agentSession ?? false
  }

  /** The readable frontmost window, or null when nothing readable is in front (blocked/none). */
  observeFrontmost(win: WindowLike | null): AssistantMatch | null {
    this.frontWin = win
    const match = win ? this.classify(win) : null
    this.front = win && match ? toInfo(win, match) : null
    this.recompute()
    return match
  }

  /** A full scan of the visible (readable) windows. */
  observeVisible(wins: readonly WindowLike[]): void {
    this.visible = []
    for (const win of wins) {
      const match = this.classify(win)
      if (match) this.visible.push(toInfo(win, match))
    }
    this.recompute()
  }

  /**
   * The helper's focused element changed. A composer in the frontmost (readable) window is
   * remembered for that window and the window is classified again right away.
   */
  observeFocus(element: FocusedElement | null): void {
    const win = this.frontWin
    if (!element || !win || element.pid !== win.pid) return
    const composer = composerOf(element, win.frame ?? null)
    if (!composer) return
    this.hint = { windowKey: windowKey(win), site: siteOf(win.url), composer }
    const match = this.classify(win)
    this.front = match ? toInfo(win, match) : null
    this.recompute()
  }

  /** Capture stopped or paused: nothing is known to be open. */
  reset(): void {
    this.front = null
    this.frontWin = null
    this.visible = []
    this.hint = null
    this.recompute()
  }

  private composerFor(win: WindowLike): ComposerHint | null {
    const hint = this.hint
    if (!hint || hint.windowKey !== windowKey(win)) return null
    return hint.site === siteOf(win.url) ? hint.composer : null
  }

  private recompute(): void {
    const next = this.front ?? this.visible[0] ?? null
    if (sameChat(next, this.current)) return
    this.current = next
    this.onChange(next)
  }
}

function siteOf(url: string | null): string | null {
  const p = parseUrl(url)
  return p?.host ? p.host : null
}

function toInfo(win: WindowLike, match: AssistantMatch): AiChatInfo {
  return {
    key: match.assistant.key,
    assistant: match.assistant.name,
    pid: win.pid,
    bundleId: win.bundleId,
    url: win.url,
    windowTitle: win.title,
  }
}

function sameChat(a: AiChatInfo | null, b: AiChatInfo | null): boolean {
  if (a === null || b === null) return a === b
  return (
    a.key === b.key &&
    a.pid === b.pid &&
    a.bundleId === b.bundleId &&
    a.url === b.url &&
    a.windowTitle === b.windowTitle
  )
}
