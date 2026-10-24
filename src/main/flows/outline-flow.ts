/**
 * Outline (a right-⌥ tap on a page being read): Dumbledore marks
 * what the student needs to read on the PDF or article in front of them, for the subject the
 * page belongs to.
 *
 *   1. the front window's lines with their screen boxes (Accessibility or OCR),
 *   2. the page's subject (what perception linked it to, else the subject studied last),
 *   3. P15 with the subject's goal, gaps, mastered concepts and open questions → line ranges,
 *   4. ranges → one rectangle each (the union of their line boxes) → the overlay draws them,
 *   5. every "read" passage is saved to the subject as a highlight note, so Memory, roadmaps
 *      and exams know what the student was pointed to.
 */
import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { Concept, Id } from '@shared/domain'
import type { Rect } from '@shared/geometry'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineMark, OutlineOverlay } from '@shared/state'

/** A page needs this many positioned lines to be worth outlining. */
export const MIN_LINES = 6

export type OutlineResult =
  | { kind: 'shown'; read: number; marks: number; subjectId: Id }
  | { kind: 'unreadable' }
  /** A private page: an excluded app or site, a private window, a password manager. */
  | { kind: 'private' }
  | { kind: 'noSubject' }
  | { kind: 'nothing'; subjectId: Id }
  /** Esc while the AI was answering: nothing to say, the router already said "Cancelled". */
  | { kind: 'cancelled' }

export interface OutlineFlowDeps {
  repos: Repos
  /** The front window with line boxes in global screen points; 'private' when it must not be read. */
  frontWindow: () => Promise<PerceivedWindow | 'private' | null>
  /** The subject this page belongs to (perception's link, else the last one studied). */
  subjectFor: (window: PerceivedWindow) => Id | null
  /** P15 (Brain.outline once wired). */
  outline: (input: OutlineInput, opts?: { signal?: AbortSignal }) => Promise<OutlineOutput>
  /** Shows the marks (null clears them). */
  show: (outline: OutlineOverlay | null) => void
  /** Tells the windows that this subject's memory changed. */
  changed: (subjectId: Id) => void
  /** Runs fn every ms until the returned stop is called (tests pass a manual clock). */
  every?: (ms: number, fn: () => void) => () => void
}

/** Struggling first, then concepts still under half way: what the page should help with. */
function gaps(concepts: readonly Concept[]): OutlineInput['gaps'] {
  const struggling = concepts
    .filter((c) => c.status === 'struggling')
    .sort((a, b) => b.struggleCount - a.struggleCount)
  const weak = concepts.filter((c) => c.status === 'learning' && c.mastery < 0.5)
  return [...struggling, ...weak].slice(0, 12).map((c) => ({
    name: c.name,
    why:
      c.struggleCount > 0 ? `stuck ${c.struggleCount}×` : `${Math.round(c.mastery * 100)}% there`,
  }))
}

/** The smallest rectangle around every box. */
export function union(boxes: readonly Rect[]): Rect | null {
  if (boxes.length === 0) return null
  const x = Math.min(...boxes.map((b) => b.x))
  const y = Math.min(...boxes.map((b) => b.y))
  const right = Math.max(...boxes.map((b) => b.x + b.width))
  const bottom = Math.max(...boxes.map((b) => b.y + b.height))
  return { x, y, width: right - x, height: bottom - y }
}

/** Lines sent to P15: from just above the first visible line, about two screens' worth. */
export const OUTLINE_LINES = 220
/** How often the marks re-read the page to follow a scroll. */
export const FOLLOW_MS = 1000

/** Reference-list lines: never worth reading for a gap (and never saved as notes). */
export function isCitation(text: string): boolean {
  return /\bISBN\b|\bdoi\b|\bRetrieved\s+\d|Archived from|^\s*\^|\bpp?\.\s*\d|\(\d{4}\)\.\s|^\s*\[\d+\]\s*$/i.test(
    text,
  )
}

type Boxed = PerceivedWindow['lines'][number] & { box: Rect }

/** The page's lines worth outlining: positioned, not citations, starting near the screen. */
export function pageLines(win: PerceivedWindow): Boxed[] {
  const lines = win.lines.filter(
    (l): l is Boxed => l.box !== null && l.text.trim().length > 0 && !isCitation(l.text),
  )
  const top = win.frame?.y ?? Number.NEGATIVE_INFINITY
  const first = Math.max(
    0,
    lines.findIndex((l) => l.box.y + l.box.height > top),
  )
  return lines.slice(Math.max(0, first - 3), Math.max(0, first - 3) + OUTLINE_LINES)
}

export class OutlineFlow {
  private follow: { stop: () => void } | null = null

  constructor(private readonly deps: OutlineFlowDeps) {}

  clear(): void {
    this.follow?.stop()
    this.follow = null
    this.deps.show(null)
  }

  async run(signal?: AbortSignal): Promise<OutlineResult> {
    const { repos } = this.deps
    if (this.follow) this.clear()
    const front = await this.deps.frontWindow()
    if (front === 'private') return { kind: 'private' }
    const win = front
    const lines = win ? pageLines(win) : []
    if (!win || lines.length < MIN_LINES) return { kind: 'unreadable' }
    const subjectId = this.deps.subjectFor(win)
    const subject = subjectId ? repos.subjects.get(subjectId) : null
    if (!subject) return { kind: 'noSubject' }

    const concepts = repos.concepts.listBySubject(subject.id)
    const input: OutlineInput = {
      subject: { name: subject.name, goal: subject.goal },
      page: { title: win.title, app: win.appName },
      gaps: gaps(concepts),
      known: concepts
        .filter((c) => c.status === 'mastered')
        .map((c) => c.name)
        .slice(0, 20),
      openQuestions: repos.encounters.openQuestions(subject.id, 8),
      lines: lines.map((l, i) => ({ i, text: l.text })),
      language: repos.profile.get().promptLanguage,
    }
    const out = await this.deps.outline(input, { signal })
    if (signal?.aborted) return { kind: 'cancelled' }

    const marks: OutlineMark[] = []
    let order = 0
    for (const r of out.ranges) {
      const boxes = lines.slice(r.from, r.to + 1).map((l) => l.box)
      const rect = union(boxes)
      if (!rect) continue
      marks.push({
        rect,
        lines: boxes,
        verdict: r.verdict,
        why: r.why,
        order: r.verdict === 'read' ? ++order : null,
      })
    }
    if (marks.length === 0) return { kind: 'nothing', subjectId: subject.id }
    const readWords = out.ranges
      .filter((r) => r.verdict === 'read')
      .flatMap((r) => lines.slice(r.from, r.to + 1))
      .reduce((n, l) => n + l.text.split(/\s+/).filter(Boolean).length, 0)
    const outline: OutlineOverlay = {
      windowId: win.windowId,
      frame: win.frame,
      title: win.title,
      subjectName: subject.name,
      summary: out.summary,
      minutes: Math.max(1, Math.round(readWords / 200)),
      marks,
    }
    this.deps.show(outline)
    const first = out.ranges[0]
    const anchor = first ? lines[first.from] : undefined
    if (anchor) this.startFollow(outline, anchor.text, anchor.box.y)

    const reads = out.ranges.filter((r) => r.verdict === 'read').slice(0, 5)
    for (const r of reads) {
      const text = lines
        .slice(r.from, r.to + 1)
        .map((l) => l.text.trim())
        .join(' ')
      repos.notes.add({
        subjectId: subject.id,
        conceptId: null,
        encounterId: null,
        kind: 'highlight',
        text,
        keywords: [r.why],
        source: { app: win.appName, bundleId: win.bundleId, url: win.url, title: win.title },
      })
    }
    if (reads.length > 0) this.deps.changed(subject.id)
    return { kind: 'shown', read: reads.length, marks: marks.length, subjectId: subject.id }
  }

  /**
   * Keeps the marks on their text: re-reads the page every FOLLOW_MS and moves the marks by how
   * far the first marked line moved (a scroll). Another window in front, or the line gone (a new
   * page), clears them.
   */
  private startFollow(outline: OutlineOverlay, anchorText: string, anchorY: number): void {
    let shown = outline
    let y = anchorY
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const win = await this.deps.frontWindow()
        if (this.follow !== handle) return
        if (!win || win === 'private' || win.windowId !== shown.windowId) return this.clear()
        const candidates = win.lines.filter((l) => l.box && l.text === anchorText)
        const next = candidates
          .map((l) => l.box?.y ?? y)
          .sort((a, b) => Math.abs(a - y) - Math.abs(b - y))[0]
        if (next === undefined) return this.clear()
        const dy = next - y
        if (Math.abs(dy) < 1) return
        y = next
        shown = {
          ...shown,
          frame: win.frame,
          marks: shown.marks.map((m) => ({
            ...m,
            rect: { ...m.rect, y: m.rect.y + dy },
            lines: m.lines?.map((b) => ({ ...b, y: b.y + dy })),
          })),
        }
        this.deps.show(shown)
      } finally {
        busy = false
      }
    }
    const stop = (this.deps.every ?? every)(FOLLOW_MS, () => void tick())
    const handle = { stop }
    this.follow = handle
  }
}

function every(ms: number, fn: () => void): () => void {
  const timer = setInterval(fn, ms)
  return () => clearInterval(timer)
}
