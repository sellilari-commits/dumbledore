/**
 * HighlightWatcher: text the student selects (marks) on screen is a flag, "this matters". Every
 * 500 ms it reads the current selection through the helper (`ax.selectedText`: AXSelectedText or
 * the Chromium/WebKit text-marker range; no OCR). A selection that comes back unchanged on two
 * polls in a row has been let go of, so it is caught within about a second; while it keeps
 * changing (still dragging) nothing is saved. Perception decides when watching is allowed
 * (capture on, a readable page in front, focus not in an editable field) and stores the text.
 *
 * Cut-off fragments never get in (Ilari, 2026-10-25): word pieces left at either edge of the
 * selection ("rs (hidden layers). A n") are trimmed, and what is left under MIN_HIGHLIGHT_WORDS
 * words is not a highlight.
 */
import type { Cancel, Clock } from '../clock'
import type { HelperClient } from '../contracts'

export const HIGHLIGHT_POLL_MS = 500
export const MIN_HIGHLIGHT_CHARS = 3
/** Fewer words than this (after trimming cut edges) is a fragment, not a highlight. */
export const MIN_HIGHLIGHT_WORDS = 3
export const MAX_HIGHLIGHT_CHARS = 2000
const LOG_EVERY_MS = 60_000

export interface HighlightWatcherDeps {
  helper: HelperClient
  clock: Clock
  /** Capture on, something readable and not excluded in front, focus not in a text field. */
  canWatch: () => boolean
  /** A selection held still (once per selection). */
  onHighlight: (text: string) => void
  log?: (message: string, error?: unknown) => void
  pollMs?: number
}

/** Short words that are whole on their own; another 1–2 letter edge token looks cut. */
const SHORT_WORDS = new Set(
  'a i an as at be by do go if in is it me my no of on or so to up us we ai ok'.split(' '),
)
/** Words a selection never ends on: the student let go one word too far ("…model. The"). */
const TRAILING_STOP = new Set(
  'a an the and or of to in on at by for with is are was that which'.split(' '),
)
const lettersOf = (token: string) => token.replace(/[^\p{L}]/gu, '')

/** Trims edge tokens that look cut off: "n John von Neumann's model. The" → "John … model." */
export function trimCutEdges(text: string): string {
  const tokens = text.split(' ').filter(Boolean)
  const cutStart = (t: string) => {
    const w = lettersOf(t)
    return w.length > 0 && w.length <= 2 && w === w.toLowerCase() && !SHORT_WORDS.has(w)
  }
  const cutEnd = (t: string) => {
    if (/[.!?)\]"”]$/.test(t)) return false
    const w = lettersOf(t).toLowerCase()
    return (w.length > 0 && w.length <= 2 && !SHORT_WORDS.has(w)) || TRAILING_STOP.has(w)
  }
  while (tokens.length > 0 && cutStart(tokens[0] ?? '')) tokens.shift()
  for (let i = 0; i < 3 && tokens.length > 0 && cutEnd(tokens[tokens.length - 1] ?? ''); i++)
    tokens.pop()
  return tokens.join(' ')
}

const wordCount = (text: string) => text.split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length

/**
 * Whitespace collapsed, cut edges trimmed, cut at MAX_HIGHLIGHT_CHARS; null when too short to be
 * a note (under MIN_HIGHLIGHT_CHARS characters or MIN_HIGHLIGHT_WORDS words).
 */
export function normalizeHighlight(raw: string | null | undefined): string | null {
  const text = trimCutEdges((raw ?? '').replace(/\s+/g, ' ').trim())
  if (text.length < MIN_HIGHLIGHT_CHARS || wordCount(text) < MIN_HIGHLIGHT_WORDS) return null
  return text.slice(0, MAX_HIGHLIGHT_CHARS).trim()
}

export class HighlightWatcher {
  private cancel: Cancel | null = null
  private busy = false
  /** The selection seen on the last poll. */
  private last: string | null = null
  /** The selection already reported, so a selection left in place fires once. */
  private taken: string | null = null
  private lastLogAt = Number.NEGATIVE_INFINITY

  constructor(private readonly deps: HighlightWatcherDeps) {}

  start(): void {
    if (this.cancel) return
    const ms = this.deps.pollMs ?? HIGHLIGHT_POLL_MS
    this.cancel = this.deps.clock.setInterval(() => void this.poll(), ms)
  }

  stop(): void {
    this.cancel?.()
    this.cancel = null
    this.last = null
    this.taken = null
  }

  /** One poll (also used by tests). */
  async poll(): Promise<void> {
    if (this.busy) return
    if (!this.deps.canWatch()) {
      this.last = null
      return
    }
    this.busy = true
    try {
      const res = await this.deps.helper.call('ax.selectedText', {})
      // Stillness is judged on the raw selection; only what is kept is trimmed.
      const raw = (res?.text ?? '').replace(/\s+/g, ' ').trim()
      if (!raw) {
        this.last = null
        this.taken = null
        return
      }
      if (raw !== this.last) {
        this.last = raw // new or still changing: wait for it to hold still
        return
      }
      if (raw === this.taken) return
      this.taken = raw
      const text = normalizeHighlight(raw)
      if (text) this.deps.onHighlight(text)
    } catch (error) {
      this.last = null
      const now = this.deps.clock.now()
      if (now - this.lastLogAt >= LOG_EVERY_MS) {
        this.lastLogAt = now
        this.deps.log?.('[perception] could not read the selection', error)
      }
    } finally {
      this.busy = false
    }
  }
}
