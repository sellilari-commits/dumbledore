/**
 * The page's text for an outline (P15), shared by the outline flow and its eval: which lines are
 * on screen, which are worth sending (no citations; in an AI chat no student messages), how a
 * page too long for one call is cut around what is on screen, and how text is compared across
 * line breaks (a paragraph read out of view vs the same text as lines on screen).
 */
import type { Rect } from '@shared/geometry'
import type { PerceivedWindow } from '@shared/helper-protocol'

/** At most this many of the page's lines go to P15 (its own cap, OUTLINE_MAX_LINES, is 400). */
export const OUTLINE_LINES = 400
/** …and at most this much text (a line out of view is a whole paragraph). */
export const OUTLINE_CHARS = 100_000
/** A screen line this long is matched inside a passage's text (a paragraph read out of view). */
export const MIN_MATCH = 12

/** Reference-list lines: never worth reading for a gap (and never saved as notes). */
export function isCitation(text: string): boolean {
  return /\bISBN\b|\bdoi\b|\bRetrieved\s+\d|Archived from|^\s*\^|\bpp?\.\s*\d|\(\d{4}\)\.\s|^\s*\[\d+\]\s*$/i.test(
    text,
  )
}

export type Boxed = PerceivedWindow['lines'][number] & { box: Rect }

/**
 * On screen: a real box, mostly inside the window. Text scrolled out of view comes from Chrome's
 * Accessibility squeezed to the window's edge with no height; marking it would highlight nothing.
 */
export function onScreen(box: Rect, frame: Rect | null | undefined): boolean {
  // Under 2 pt is squashed (scrolled out of view) or screen-reader-only text (Ilari, 4ccbd92).
  if (box.height < 2 || box.width <= 0) return false
  if (!frame) return true
  const half = box.height / 2
  return box.y >= frame.y - half && box.y + box.height <= frame.y + frame.height + half
}

/** On-screen lines worth marking: a real box, not a citation. */
export function pageLines(win: PerceivedWindow): Boxed[] {
  return win.lines.filter(
    (l): l is Boxed =>
      l.box !== null &&
      l.text.trim().length > 0 &&
      !isCitation(l.text) &&
      onScreen(l.box, win.frame),
  )
}

/**
 * The whole page's text, in page order, on screen or not (a whole-page read gives all of it), so
 * the choice is made over the entire page. A page longer than OUTLINE_LINES / OUTLINE_CHARS is cut
 * around what is on screen (a third before it, the rest after). In an AI chat the student's own
 * right-aligned messages are left out: only the answers count.
 */
export function pageText(win: PerceivedWindow, aiChat: boolean): PerceivedWindow['lines'] {
  const lines = win.lines
    .filter((l) => l.text.trim().length > 0 && !isCitation(l.text))
    .filter((l) => !aiChat || l.align !== 'right')
  const first = Math.max(
    0,
    lines.findIndex((l) => l.box !== null && onScreen(l.box, win.frame)),
  )
  let from = first
  let to = first
  let chars = 0
  for (let step = 0; ; step++) {
    let grew = false
    // Two lines after the screen for every one before it.
    for (const before of step % 3 === 2 ? [true, false] : [false, true]) {
      const i = before ? from - 1 : to
      const line = lines[i]
      if (!line || to - from >= OUTLINE_LINES || chars + line.text.length > OUTLINE_CHARS) continue
      if (before) from--
      else to++
      chars += line.text.length
      grew = true
      break
    }
    if (!grew) break
  }
  return lines.slice(from, to)
}

/** Text compared across line breaks: case, runs of spaces and spaces before punctuation ignored. */
export function norm(text: string): string {
  return text
    .replace(/\s+/g, ' ')
    .replace(/ ([.,;:!?)\]}%])/g, '$1')
    .replace(/([([{]) /g, '$1')
    .trim()
    .toLowerCase()
}

/** Where a screen line is on the page: its own line, else the paragraph it is part of; -1 if none. */
export function placeOn(page: readonly string[], text: string): number {
  const exact = page.indexOf(text)
  if (exact >= 0 || text.length < MIN_MATCH) return exact
  return page.findIndex((p) => p.includes(text))
}
