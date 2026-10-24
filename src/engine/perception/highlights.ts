/**
 * HighlightWatcher: text the student selects (marks) on screen is a flag, "this matters". Every
 * 500 ms it reads the current selection through the helper (`ax.selectedText`: AXSelectedText or
 * the Chromium/WebKit text-marker range; no OCR). A selection that comes back unchanged on two
 * polls in a row has been let go of, so it is caught within about a second; while it keeps
 * changing (still dragging) nothing is saved. Perception decides when watching is allowed
 * (capture on, a readable page in front, focus not in an editable field) and stores the text.
 */
import type { Cancel, Clock } from '../clock'
import type { HelperClient } from '../contracts'

export const HIGHLIGHT_POLL_MS = 500
export const MIN_HIGHLIGHT_CHARS = 3
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

/** Whitespace collapsed, cut at MAX_HIGHLIGHT_CHARS; null when too short to be a note. */
export function normalizeHighlight(raw: string | null | undefined): string | null {
  const text = (raw ?? '').replace(/\s+/g, ' ').trim()
  if (text.length < MIN_HIGHLIGHT_CHARS) return null
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
      const text = normalizeHighlight(res?.text)
      if (!text) {
        this.last = null
        this.taken = null
        return
      }
      if (text !== this.last) {
        this.last = text // new or still changing: wait for it to hold still
        return
      }
      if (text === this.taken) return
      this.taken = text
      this.deps.onHighlight(text)
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
