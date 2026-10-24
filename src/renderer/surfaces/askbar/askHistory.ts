/**
 * The Ask bar conversation's bookkeeping: thread names, the "New chat" marker (an ISO time kept in
 * localStorage, so a restart doesn't bring an old chat back) and which stored messages belong to
 * the current chat. Main filters its context with the same marker (`ask.submit`'s `since`).
 */
import type { ChatMessage } from '@shared/domain'

export const ASK_THREAD = 'ask'

/** chat.delta threads that belong to the Ask bar ('askbar' kept for older mains). */
export const ASK_THREADS: ReadonlySet<string> = new Set([ASK_THREAD, 'askbar'])

/** The newest stored messages the bar shows at most; older ones stay in the app's history. */
export const VISIBLE_LIMIT = 60

const SINCE_KEY = 'dumbledore.ask.since'

const parse = (iso: string | null | undefined): number | null => {
  const ms = iso ? Date.parse(iso) : Number.NaN
  return Number.isFinite(ms) ? ms : null
}

/** The last "New chat" time, or null when the bar never started over (or storage is blocked). */
export function loadSince(): string | null {
  try {
    const value = window.localStorage.getItem(SINCE_KEY)
    return parse(value) === null ? null : value
  } catch {
    return null
  }
}

export function saveSince(since: string): void {
  try {
    window.localStorage.setItem(SINCE_KEY, since)
  } catch {
    // Private storage off: the reset still holds until the window reloads.
  }
}

/** Stored messages that are part of the current chat (after `since`), newest VISIBLE_LIMIT. */
export function currentChat<T extends ChatMessage>(messages: T[], since: string | null): T[] {
  const after = parse(since)
  const kept = after === null ? messages : messages.filter((m) => Date.parse(m.createdAt) > after)
  return kept.length > VISIBLE_LIMIT ? kept.slice(-VISIBLE_LIMIT) : kept
}
