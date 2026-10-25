/**
 * Outline (right-⌥ hold): Dumbledore reads the whole page in front of the student (a PDF, an
 * article or an AI chat's answers), chooses what to read for the subject's goal and gaps across
 * all of it, and marks the passages that are on screen; the card counts the ones further up or
 * down, and those light up as the student scrolls to them. In an AI chat
 * only the assistant's answers are marked (P15 gets kind 'ai_chat'; the student's own
 * right-aligned bubbles are left out).
 *
 *   1. the front window's whole text (Accessibility: the lines on screen with their boxes, the
 *      rest of the page without; OCR: what is on screen),
 *   2. the page's subject (what perception linked it to, else the subject studied last),
 *   3. P15 with the subject's goal, gaps, mastered concepts and open questions → line ranges,
 *   4. ranges → one rectangle each (the union of their line boxes) → the overlay draws them,
 *   5. every "read" passage is saved to the subject as a highlight note, so Memory, roadmaps
 *      and exams know what the student was pointed to.
 */
import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import { openQuestionsOf } from '@engine/memory/questions'
import {
  MIN_MATCH,
  norm,
  onScreen,
  pageLines,
  pageText,
  placeOn,
} from '@engine/perception/outline-page'
import type { Concept, Id } from '@shared/domain'
import type { Rect } from '@shared/geometry'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineMark, OutlineOverlay } from '@shared/state'

// The page's text helpers moved to the engine (the eval uses them too); kept importable here.
export {
  isCitation,
  norm,
  OUTLINE_CHARS,
  OUTLINE_LINES,
  pageLines,
  pageText,
} from '@engine/perception/outline-page'

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
  /**
   * The front window with line boxes in global screen points; 'private' when it must not be read.
   * `wholePage`: all of the page's text (lines out of view have no box), for the choice; without
   * it only what is on screen, for following a scroll.
   */
  frontWindow: (opts?: { wholePage?: boolean }) => Promise<PerceivedWindow | 'private' | null>
  /** The subject this page belongs to (perception's link, else the last one studied). */
  subjectFor: (window: PerceivedWindow) => Id | null
  /** Whether the window is a conversation with an AI assistant (ChatGPT, Claude, …). */
  isAiChat?: (window: PerceivedWindow) => boolean
  /** P15 (Brain.outline once wired). */
  outline: (input: OutlineInput, opts?: { signal?: AbortSignal }) => Promise<OutlineOutput>
  /** Shows the marks (null clears them). */
  show: (outline: OutlineOverlay | null) => void
  /** Tells the windows that this subject's memory changed. */
  changed: (subjectId: Id) => void
  /** Runs fn every ms until the returned stop is called (tests pass a manual clock). */
  every?: (ms: number, fn: () => void) => () => void
  /** Epoch ms (tests pass a fixed clock). */
  now?: () => number
  /** Waits (tests pass an instant one). */
  sleep?: (ms: number) => Promise<void>
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

/** How often the marks re-read the page to follow a scroll (and light up passages scrolled to). */
export const FOLLOW_MS = 500

/** A passage P15 chose, kept by its lines' text so it is found again wherever the page scrolls. */
export interface Chosen {
  verdict: OutlineMark['verdict']
  why: string
  order: number | null
  texts: string[]
  /** Its first line's index in the page's text (`page` below): above or below the screen. */
  at: number
}

/**
 * Marks for the chosen passages that are on screen now, matched by text (a screen line is matched
 * as itself or inside a passage's paragraph read out of view); the passages to read that are
 * elsewhere on the page are counted (above / below the screen, by where they sit in `page`, the
 * page's text as `norm`ed lines), so the card can say where to scroll. `found` is false when
 * neither a passage nor any line on screen is on that page any more (another page).
 */
export function drawMarks(
  chosen: readonly Chosen[],
  win: PerceivedWindow,
  page: readonly string[],
): { marks: OutlineMark[]; above: number; below: number; found: boolean } {
  const shown = pageLines(win).map((l) => ({ box: l.box, text: norm(l.text) }))
  // Boxed lines off screen (OCR, or Chrome's squashed ones): their height says up or down.
  const offAt = new Map<string, number>()
  for (const l of win.lines) {
    if (l.box && !onScreen(l.box, win.frame) && !offAt.has(norm(l.text)))
      offAt.set(norm(l.text), l.box.y)
  }
  const middle = win.frame ? win.frame.y + win.frame.height / 2 : 0
  const at = shown.map((l) => placeOn(page, l.text)).filter((i) => i >= 0)
  const top = at.length > 0 ? Math.min(...at) : null
  const bottom = at.length > 0 ? Math.max(...at) : null
  const taken = new Set<number>()
  const marks: OutlineMark[] = []
  let above = 0
  let below = 0
  let found = top !== null
  for (const c of chosen) {
    const own = new Set(c.texts.map(norm))
    const whole = norm(c.texts.join(' '))
    const boxes: Rect[] = []
    shown.forEach((l, i) => {
      if (taken.has(i)) return
      if (!own.has(l.text) && (l.text.length < MIN_MATCH || !whole.includes(l.text))) return
      taken.add(i)
      boxes.push(l.box)
    })
    const rect = union(boxes)
    if (rect) {
      found = true
      marks.push({ rect, lines: boxes, verdict: c.verdict, why: c.why, order: c.order })
      continue
    }
    const y = c.texts.map((t) => offAt.get(norm(t))).find((v) => v !== undefined)
    if (y !== undefined) found = true
    if (c.verdict !== 'read') continue
    if (top !== null && bottom !== null) {
      if (c.at < top) above++
      else if (c.at > bottom) below++
    } else if (y !== undefined) {
      if (y < middle) above++
      else below++
    }
  }
  return { marks, above, below, found }
}

/** Wait before the second read of a page that gave almost no text (its Accessibility warming up). */
export const RETRY_MS = 700

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

/** How long a page keeps its outline: holding again shows the same marks, not a new guess. */
export const REMEMBER_MS = 15 * 60_000

interface Remembered {
  at: number
  chosen: Chosen[]
  /** The page's text the passages were chosen from, `norm`ed: where the screen is on it. */
  page: string[]
  summary: string
  minutes: number
}

export class OutlineFlow {
  private follow: { stop: () => void } | null = null
  /** The last outlines, by page, subject and what the student knows (gaps, mastered, questions). */
  private readonly remembered = new Map<string, Remembered>()

  constructor(private readonly deps: OutlineFlowDeps) {}

  clear(): void {
    this.follow?.stop()
    this.follow = null
    this.deps.show(null)
  }

  async run(signal?: AbortSignal): Promise<OutlineResult> {
    const { repos } = this.deps
    if (this.follow) this.clear()
    let front = await this.deps.frontWindow({ wholePage: true })
    if (front === 'private') return { kind: 'private' }
    // A browser or Electron app builds its text for Accessibility on the first read: read again.
    if (!front || pageText(front, false).length < MIN_LINES) {
      await (this.deps.sleep ?? sleep)(RETRY_MS)
      if (signal?.aborted) return { kind: 'cancelled' }
      front = await this.deps.frontWindow({ wholePage: true })
      if (front === 'private') return { kind: 'private' }
    }
    const win = front
    const aiChat = win ? (this.deps.isAiChat?.(win) ?? false) : false
    // The whole page counts: a page that starts with a big header or image is still read, and
    // the edge cue points to its passages.
    const lines = win ? pageText(win, aiChat) : []
    if (!win || lines.length < MIN_LINES) return { kind: 'unreadable' }
    const subjectId = this.deps.subjectFor(win)
    const subject = subjectId ? repos.subjects.get(subjectId) : null
    if (!subject) return { kind: 'noSubject' }

    const concepts = repos.concepts.listBySubject(subject.id)
    const now = this.deps.now?.() ?? Date.now()
    const input: OutlineInput = {
      subject: { name: subject.name, goal: subject.goal },
      page: { title: win.title, app: win.appName, kind: aiChat ? 'ai_chat' : 'page' },
      gaps: gaps(concepts),
      known: concepts
        .filter((c) => c.status === 'mastered')
        .map((c) => c.name)
        .slice(0, 20),
      openQuestions: openQuestionsOf(repos, subject.id, 8),
      lines: lines.map((l, i) => ({ i, text: l.text })),
      language: repos.profile.get().promptLanguage,
    }
    // The same page for the same student shows the same marks: no second guess, and instant.
    const key = JSON.stringify([
      subject.id,
      win.url ?? win.title,
      input.gaps,
      input.known,
      input.openQuestions,
      lines.length,
      lines[0]?.text,
      lines.at(-1)?.text,
    ])
    const kept = this.remembered.get(key)
    const fresh = !kept || now - kept.at > REMEMBER_MS
    let memo: Remembered
    if (kept && !fresh) memo = kept
    else {
      const out = await this.deps.outline(input, { signal })
      if (signal?.aborted) return { kind: 'cancelled' }
      let order = 0
      const chosen: Chosen[] = out.ranges
        .map((r) => ({
          verdict: r.verdict,
          why: r.why,
          order: r.verdict === 'read' ? ++order : null,
          texts: lines.slice(r.from, r.to + 1).map((l) => l.text),
          at: r.from,
        }))
        .filter((c) => c.texts.length > 0)
      const readWords = chosen
        .filter((c) => c.verdict === 'read')
        .flatMap((c) => c.texts)
        .reduce((n, t) => n + t.split(/\s+/).filter(Boolean).length, 0)
      memo = {
        at: now,
        chosen,
        page: lines.map((l) => norm(l.text)),
        summary: out.summary,
        minutes: Math.max(1, Math.round(readWords / 200)),
      }
      this.remembered.set(key, memo)
    }
    const { chosen, page } = memo
    if (chosen.length === 0) return { kind: 'nothing', subjectId: subject.id }
    const reads = chosen.filter((c) => c.verdict === 'read')
    const base: Omit<OutlineOverlay, 'marks' | 'above' | 'below'> = {
      windowId: win.windowId,
      frame: win.frame,
      title: win.title,
      subjectName: subject.name,
      summary: memo.summary,
      minutes: memo.minutes,
      basis: {
        goal: subject.goal,
        gaps: input.gaps.slice(0, 3).map((g) => g.name),
        questions: input.openQuestions.length,
        lines: lines.length,
        offScreen: lines.filter((l) => !l.box || !onScreen(l.box, win.frame)).length,
      },
    }
    const drawn = drawMarks(chosen, win, page)
    this.deps.show({ ...base, marks: drawn.marks, above: drawn.above, below: drawn.below })
    this.startFollow(base, chosen, page, win.windowId)
    if (!fresh) {
      return { kind: 'shown', read: reads.length, marks: drawn.marks.length, subjectId: subject.id }
    }

    for (const r of reads.slice(0, 5)) {
      const text = r.texts.map((t) => t.trim()).join(' ')
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
    return {
      kind: 'shown',
      read: Math.min(reads.length, 5),
      marks: drawn.marks.length,
      subjectId: subject.id,
    }
  }

  /**
   * Keeps the marks on their text: re-reads what is on screen every FOLLOW_MS (quick, not the
   * whole page) and finds each chosen passage again, so marks move with a scroll either way and
   * passages light up as they come into view. Another window in front, or a screen that is not on
   * the outlined page any more (another page), clears them.
   */
  private startFollow(
    base: Omit<OutlineOverlay, 'marks' | 'above' | 'below'>,
    chosen: readonly Chosen[],
    page: readonly string[],
    windowId: number | null,
  ): void {
    let last = ''
    let busy = false
    const tick = async () => {
      if (busy) return
      busy = true
      try {
        const win = await this.deps.frontWindow()
        if (this.follow !== handle) return
        if (!win || win === 'private' || win.windowId !== windowId) return this.clear()
        const drawn = drawMarks(chosen, win, page)
        if (!drawn.found) return this.clear()
        const next: OutlineOverlay = {
          ...base,
          frame: win.frame,
          marks: drawn.marks,
          above: drawn.above,
          below: drawn.below,
        }
        const key = JSON.stringify([next.frame, next.marks, next.above, next.below])
        if (key === last) return
        last = key
        this.deps.show(next)
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
