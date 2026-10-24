/**
 * Behaviour signals for episodes (docs/PLAN.md §6.4 "Signals"): search queries parsed from
 * search-engine URLs, a running reading-speed baseline, revisits per day, scroll-backs and the
 * student's own messages in AI chats.
 */
import { hostMatches, parseUrl } from '../../privacy/url'
import type { MergedLine } from './merged-text'

// ─── Search queries ─────────────────────────────────────────────────────────────────────────

const ENGINES: readonly { name: string; host: string; path: RegExp; param: string }[] = [
  { name: 'google_scholar', host: 'scholar.google.*', path: /^\/scholar/, param: 'q' },
  { name: 'google', host: 'google.*', path: /^\/search/, param: 'q' },
  { name: 'bing', host: 'bing.com', path: /^\/search/, param: 'q' },
  { name: 'duckduckgo', host: 'duckduckgo.com', path: /^\/(html\/?)?$/, param: 'q' },
  { name: 'ecosia', host: 'ecosia.org', path: /^\/search/, param: 'q' },
  { name: 'brave', host: 'search.brave.com', path: /^\/search/, param: 'q' },
  { name: 'kagi', host: 'kagi.com', path: /^\/search/, param: 'q' },
  { name: 'startpage', host: 'startpage.com', path: /^\/(do\/)?search/, param: 'query' },
  { name: 'yahoo', host: 'search.yahoo.com', path: /^\/search/, param: 'p' },
  { name: 'youtube', host: 'youtube.com', path: /^\/results/, param: 'search_query' },
  { name: 'wikipedia', host: 'wikipedia.org', path: /^\/w\/index\.php/, param: 'search' },
]

/** "google.*" matches google.com, google.fi, google.co.uk … but not mail.google.com. */
function engineHostMatches(host: string, pattern: string): boolean {
  if (!pattern.endsWith('.*')) return hostMatches(host, pattern)
  const base = pattern.slice(0, -2)
  return host === base || host.startsWith(`${base}.`)
}

export function parseSearchQuery(url: string | null): { engine: string; query: string } | null {
  const p = parseUrl(url)
  if (!p?.host) return null
  for (const e of ENGINES) {
    if (!engineHostMatches(p.host, e.host) || !e.path.test(p.path)) continue
    const q = p.params.get(e.param)?.replace(/\s+/g, ' ').trim()
    if (q) return { engine: e.name, query: q.slice(0, 200) }
  }
  return null
}

export class SearchLog {
  private entries: { query: string; at: number }[] = []

  constructor(private readonly keepMs = 2 * 60 * 60 * 1000) {}

  record(query: string, at: number): void {
    const last = this.entries.at(-1)
    if (last && last.query.toLowerCase() === query.toLowerCase()) return
    this.entries.push({ query, at })
    this.entries = this.entries.filter((e) => e.at >= at - this.keepMs)
  }

  /** Distinct queries made in [from, to], oldest first, at most `limit`. */
  between(from: number, to: number, limit = 5): string[] {
    const out: string[] = []
    for (const e of this.entries) {
      if (e.at < from || e.at > to) continue
      if (!out.some((q) => q.toLowerCase() === e.query.toLowerCase())) out.push(e.query)
    }
    return out.slice(-limit)
  }
}

// ─── Reading speed ──────────────────────────────────────────────────────────────────────────

const PLAUSIBLE_WPM = { min: 20, max: 1200 }

/** Exponential moving average of the student's reading speed (words per minute). */
export class ReadingBaseline {
  private current: number | null = null

  constructor(private readonly alpha = 0.15) {}

  get value(): number | null {
    return this.current === null ? null : Math.round(this.current)
  }

  /** Seeds from earlier episodes (median), e.g. on start-up. */
  seed(samples: readonly number[]): void {
    const ok = samples
      .filter((s) => s >= PLAUSIBLE_WPM.min && s <= PLAUSIBLE_WPM.max)
      .sort((a, b) => a - b)
    if (ok.length === 0) return
    this.current = ok[Math.floor(ok.length / 2)] ?? null
  }

  update(wpm: number): void {
    if (wpm < PLAUSIBLE_WPM.min || wpm > PLAUSIBLE_WPM.max) return
    this.current = this.current === null ? wpm : this.current + this.alpha * (wpm - this.current)
  }
}

// ─── Revisits ───────────────────────────────────────────────────────────────────────────────

/** Visits per page per local day. */
export class VisitLog {
  private day = ''
  private counts = new Map<string, number>()

  /** Records a visit and returns how many earlier visits that page had today. */
  record(page: string, at: number): number {
    this.rollover(at)
    const before = this.counts.get(page) ?? 0
    this.counts.set(page, before + 1)
    return before
  }

  /** Seeds today's counts from saved episodes. */
  seed(pages: readonly string[], at: number): void {
    this.rollover(at)
    for (const p of pages) this.counts.set(p, (this.counts.get(p) ?? 0) + 1)
  }

  private rollover(at: number): void {
    const d = new Date(at)
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (day !== this.day) {
      this.day = day
      this.counts = new Map()
    }
  }
}

// ─── Scroll-backs ───────────────────────────────────────────────────────────────────────────

/**
 * Counts moves of the viewport back up the page; a run of backward moves counts once.
 *
 * Compares consecutive frames: lines on screen in both frames that moved down by ≥ `minLines`
 * mean the student scrolled up (back), lines that moved up mean forward. Lines at the same
 * position in both frames (nav bars, toolbars) are ignored. When the frames share no moving
 * lines (a jump, a page turn) the document position of their content decides.
 */
export class ScrollTracker {
  backs = 0
  private direction: 'forward' | 'back' | null = null

  constructor(private readonly minLines = 2) {}

  observe(
    previous: readonly string[] | null,
    current: readonly string[],
    documentIndex: (key: string) => number | null,
  ): void {
    if (!previous || previous.length === 0 || current.length < 3) return
    const before = new Map(previous.map((k, i) => [k, i]))
    const sticky = new Set<string>()
    let up = 0
    let down = 0
    current.forEach((key, i) => {
      const p = before.get(key)
      if (p === undefined) return
      if (p === i) sticky.add(key)
      else if (p - i >= this.minLines) up++
      else if (i - p >= this.minLines) down++
    })
    let moved: 'forward' | 'back' | null = null
    if (up + down > 0) {
      if (down > up) moved = 'back'
      else if (up > down) moved = 'forward'
    } else {
      const where = (keys: readonly string[]) =>
        median(keys.filter((k) => !sticky.has(k)).map(documentIndex).filter((n): n is number => n !== null))
      const a = where(previous)
      const b = where(current)
      if (a !== null && b !== null) {
        if (b <= a - this.minLines) moved = 'back'
        else if (b >= a + this.minLines) moved = 'forward'
      }
    }
    if (moved === 'back' && this.direction !== 'back') this.backs++
    if (moved) this.direction = moved
  }
}

function median(values: number[]): number | null {
  if (values.length === 0) return null
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)] ?? null
}

// ─── The student's messages in AI chats ─────────────────────────────────────────────────────

/** Groups consecutive lines on the student's side into messages, oldest first. */
export function studentMessages(
  lines: readonly MergedLine[],
  userAlign: 'right' | null,
  isChrome: (line: MergedLine) => boolean = () => false,
  limit = 10,
): string[] {
  if (!userAlign) return []
  const out: string[] = []
  let current: string[] = []
  const flush = () => {
    const text = current.join(' ').replace(/\s+/g, ' ').trim()
    if (text.length >= 3) out.push(text.slice(0, 400))
    current = []
  }
  for (const line of lines) {
    if (isChrome(line)) continue
    if (line.align === userAlign) current.push(line.text)
    else flush()
  }
  flush()
  return out.slice(-limit)
}
