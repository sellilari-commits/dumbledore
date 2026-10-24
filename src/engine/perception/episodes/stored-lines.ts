/**
 * Stored lines: per page, the keys of the lines already saved in an episode. A short scroll, a
 * 3-minute checkpoint or a revisit of the same page then stores only what is new (finalize in
 * open-episode.ts), plus a few context lines so the extractor still knows where it is. Bounded to
 * the most recently used pages and seeded from stored episodes when perception starts.
 */

import type { MergedLine } from './merged-text'
import { lineKey, wordCount } from './text'

export const MAX_STORED_PAGES = 500
export const MAX_CONTEXT_LINES = 3

const ALIGN_TAG = /^\[(L|C|R)\] /

/** Line keys of a stored episode's text (alignment tags removed). */
export function storedLineKeys(text: string): string[] {
  return text
    .split('\n')
    .map((l) => lineKey(l.replace(ALIGN_TAG, '')))
    .filter(Boolean)
}

export class StoredLines {
  private readonly pages = new Map<string, Set<string>>()

  constructor(private readonly maxPages = MAX_STORED_PAGES) {}

  get size(): number {
    return this.pages.size
  }

  /** The keys saved for a page (marks it recently used). */
  get(pageKey: string): ReadonlySet<string> | undefined {
    const keys = this.pages.get(pageKey)
    if (keys) this.touch(pageKey, keys)
    return keys
  }

  add(pageKey: string, keys: Iterable<string>): void {
    const set = this.pages.get(pageKey) ?? new Set<string>()
    for (const k of keys) if (k) set.add(k)
    this.touch(pageKey, set)
    while (this.pages.size > this.maxPages) {
      const oldest = this.pages.keys().next().value
      if (oldest === undefined) return
      this.pages.delete(oldest)
    }
  }

  /** Stored episodes, oldest first. */
  seed(episodes: Iterable<{ pageKey: string; text: string }>): void {
    for (const e of episodes) this.add(e.pageKey, storedLineKeys(e.text))
  }

  private touch(pageKey: string, keys: Set<string>): void {
    this.pages.delete(pageKey)
    this.pages.set(pageKey, keys)
  }
}

export interface PickedLines {
  /** Lines to store, in page order: the new ones plus context. */
  kept: MergedLine[]
  /** How many of them were not stored before. */
  fresh: number
}

const looksLikeHeading = (l: MergedLine) =>
  wordCount(l.text) <= 10 && !/[.!?,;:]$/.test(l.text.trim())

/**
 * Drops lines already stored for the page. Keeps every new line, every line that holds a
 * highlight, and up to MAX_CONTEXT_LINES context lines: the latest student message in an AI chat,
 * then the first heading-like lines (else the first line) of the segment.
 */
export function pickNewLines(
  lines: readonly MergedLine[],
  stored: ReadonlySet<string> | undefined,
  highlights: readonly string[],
  userAlign: 'right' | null,
): PickedLines {
  if (!stored || stored.size === 0) return { kept: [...lines], fresh: lines.length }
  const keep = new Set<MergedLine>()
  let fresh = 0
  const marks = highlights.map((h) => lineKey(h)).filter((k) => k.length >= 3)
  for (const l of lines) {
    if (!stored.has(l.key)) {
      keep.add(l)
      fresh++
    } else if (
      marks.some((m) => l.key.includes(m.slice(0, 40)) || (l.key.length >= 8 && m.includes(l.key)))
    ) {
      keep.add(l)
    }
  }
  if (fresh === lines.length) return { kept: [...lines], fresh }
  const context: MergedLine[] = []
  if (userAlign) {
    const question = [...lines].reverse().find((l) => l.align === userAlign)
    if (question && !keep.has(question)) context.push(question)
  }
  for (const l of lines) {
    if (context.length >= MAX_CONTEXT_LINES) break
    if (!keep.has(l) && !context.includes(l) && looksLikeHeading(l)) context.push(l)
  }
  const first = lines[0]
  if (context.length === 0 && first && !keep.has(first)) context.push(first)
  for (const l of context) keep.add(l)
  return { kept: lines.filter((l) => keep.has(l)), fresh }
}
