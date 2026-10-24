/**
 * Tracks which AI chat is open right now and reports changes ('perception:aiChat').
 *
 * The frontmost window wins. When something else is frontmost, a chat seen in the latest scan of
 * visible windows still counts (split screen: PDF + ChatGPT side by side). Detection results are
 * cached per window so unchanged frames (no lines) keep their classification.
 */
import type { AiChatInfo } from '../../contracts'
import { type WindowLike, windowKey } from '../types'
import { type AssistantMatch, detectAssistant } from './detector'

interface CacheEntry {
  url: string | null
  title: string | null
  match: AssistantMatch | null
}

const MAX_CACHE = 64

export class AiChatTracker {
  private front: AiChatInfo | null = null
  private visible: AiChatInfo[] = []
  private current: AiChatInfo | null = null
  private readonly cache = new Map<string, CacheEntry>()

  constructor(private readonly onChange: (chat: AiChatInfo | null) => void = () => {}) {}

  get(): AiChatInfo | null {
    return this.current
  }

  /** Classifies a window; frames without lines reuse the last result for the same page. */
  classify(win: WindowLike): AssistantMatch | null {
    const key = windowKey(win)
    const cached = this.cache.get(key)
    const hasLines = (win.lines?.length ?? 0) > 0
    const samePage = cached !== undefined && cached.url === win.url
    if (samePage && cached.title === win.title && (!hasLines || cached.match)) return cached.match
    let match = detectAssistant(win)
    // Chats recognised by their text (no URL) keep that result on frames without text.
    if (!match && !hasLines && samePage) match = cached.match
    this.cache.delete(key)
    this.cache.set(key, { url: win.url, title: win.title, match })
    if (this.cache.size > MAX_CACHE) {
      const oldest = this.cache.keys().next().value
      if (oldest !== undefined) this.cache.delete(oldest)
    }
    return match
  }

  /** The readable frontmost window, or null when nothing readable is in front (blocked/none). */
  observeFrontmost(win: WindowLike | null): AssistantMatch | null {
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

  /** Capture stopped or paused: nothing is known to be open. */
  reset(): void {
    this.front = null
    this.visible = []
    this.recompute()
  }

  private recompute(): void {
    const next = this.front ?? this.visible[0] ?? null
    if (sameChat(next, this.current)) return
    this.current = next
    this.onChange(next)
  }
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
