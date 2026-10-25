/**
 * The outline over the page the student is reading, in the "Soft glow" look (Olle's pick):
 *   · each passage to READ is one soft rounded shape around its lines — a faint warm tint and a
 *     gentle lift, the text untouched — with its reading-order number on its left edge, beside
 *     the first line (never over text); neighbouring passages keep a small gap between them;
 *   · SKIM passages get a faint line in the margin; SKIP passages only a quiet note beside them;
 *     the page is never dimmed or washed out;
 *   · a slim frosted pill at the bottom says how many passages, for which subject and about how
 *     long, with each passage's reason by its number; an edge cue points to passages further up
 *     or down (they light up when scrolled to); holding the Dumbledore key again clears it all.
 * Marks come in global screen points, clipped to the page's window; each overlay window (one per
 * display) draws them relative to its own origin. Never takes clicks.
 */
import { TRIGGER_KEYS } from '@renderer/pages/settings/keys'
import type { TriggerKey } from '@shared/domain'
import type { OutlineMark, OutlineOverlay } from '@shared/state'
import type { CSSProperties } from 'react'
import './outline.css'

export interface Origin {
  x: number
  y: number
}

/** This window's top-left in global screen points (the overlay covers its whole display). */
export function windowOrigin(): Origin {
  return { x: window.screenX, y: window.screenY }
}

/** How far the shape reaches beyond the passage's text. */
const PAD_X = 12
const PAD_Y = 7
/** Delay between passages as they appear (ms). */
const STAGGER = 140

function local(r: { x: number; y: number; width: number; height: number }, o: Origin) {
  return { left: r.x - o.x, top: r.y - o.y, width: r.width, height: r.height }
}

/** Room left between two neighbouring passages' shapes. */
const GAP = 6

/** Top and bottom padding per passage, shrunk where a neighbour is close, so shapes never touch. */
export function paddings(
  rects: readonly { y: number; height: number }[],
): { top: number; bottom: number }[] {
  return rects.map((r, i) => {
    let top = PAD_Y
    let bottom = PAD_Y
    rects.forEach((o, j) => {
      if (j === i) return
      const below = o.y - (r.y + r.height) // space from this one's bottom to the other's top
      const above = r.y - (o.y + o.height)
      if (below >= 0 && below < PAD_Y * 2 + GAP)
        bottom = Math.min(bottom, Math.max(0, (below - GAP) / 2))
      if (above >= 0 && above < PAD_Y * 2 + GAP) top = Math.min(top, Math.max(0, (above - GAP) / 2))
    })
    return { top, bottom }
  })
}

function ReadMark({
  mark,
  origin,
  start,
  pad,
}: {
  mark: OutlineMark
  origin: Origin
  start: number
  pad: { top: number; bottom: number }
}) {
  const p = local(mark.rect, origin)
  const first = mark.lines?.[0] ?? mark.rect
  const style = {
    left: p.left - PAD_X,
    top: p.top - pad.top,
    width: p.width + PAD_X * 2,
    height: p.height + pad.top + pad.bottom,
    '--appear-delay': `${start}ms`,
  } as CSSProperties
  // The number sits on the shape's left edge, centred on the first line.
  const numTop = first.y - mark.rect.y + pad.top + first.height / 2
  return (
    <div className="ov-glow" style={style}>
      {mark.order ? (
        <span className="ov-glow__num" style={{ top: numTop }}>
          {mark.order}
        </span>
      ) : null}
    </div>
  )
}

function SkimMark({ mark, origin }: { mark: OutlineMark; origin: Origin }) {
  const p = local(mark.rect, origin)
  return <span className="ov-skim" style={{ left: p.left - 10, top: p.top, height: p.height }} />
}

function SkipMark({ mark, origin }: { mark: OutlineMark; origin: Origin }) {
  const p = local(mark.rect, origin)
  return (
    <span className="ov-skip" style={{ left: p.left - 16, top: p.top }}>
      {mark.why ? `Skip · ${mark.why}` : 'Skip'}
    </span>
  )
}

/** Where the passages that aren't on screen are, for the card. */
export function elsewhereText(above: number, below: number): string {
  if (below > 0 && above > 0) return `${above + below} more further up and down.`
  if (below > 0) return `↓ ${below} more further down.`
  if (above > 0) return `↑ ${above} more further up.`
  return ''
}

/** Whether the page's centre is on this window's display (the card shows there only). */
function showsPage(frame: OutlineOverlay['frame'], origin: Origin): boolean {
  if (!frame) return true
  const cx = frame.x + frame.width / 2
  const cy = frame.y + frame.height / 2
  return (
    cx >= origin.x &&
    cx < origin.x + window.innerWidth &&
    cy >= origin.y &&
    cy < origin.y + window.innerHeight
  )
}

export function OutlineMarks({
  outline,
  origin = windowOrigin(),
  triggerKey = 'rightOption',
}: {
  outline: OutlineOverlay
  origin?: Origin
  triggerKey?: TriggerKey
}) {
  const frame = outline.frame ?? null
  const clip: CSSProperties | undefined = frame
    ? {
        left: frame.x - origin.x,
        top: frame.y - origin.y,
        width: frame.width,
        height: frame.height,
      }
    : undefined
  // Inside the clip, positions are relative to the page's window.
  const inner = frame ? { x: frame.x, y: frame.y } : origin
  const reads = outline.marks.filter((m) => m.verdict === 'read')
  const pads = paddings(reads.map((m) => m.rect))
  const elsewhere = elsewhereText(outline.above ?? 0, outline.below ?? 0)
  let delay = 0
  return (
    <section className="ov-outline" aria-label={`Outline for ${outline.subjectName}`}>
      <div className="ov-outline__clip" style={clip}>
        {outline.marks.map((m) => {
          // Stable per passage, so a scroll moves a mark instead of drawing it again.
          const key = `${m.verdict}|${m.order ?? ''}|${m.why}`
          if (m.verdict === 'skim') return <SkimMark key={key} mark={m} origin={inner} />
          if (m.verdict === 'skip') return <SkipMark key={key} mark={m} origin={inner} />
          const start = delay
          delay += STAGGER
          const pad = pads[reads.indexOf(m)] ?? { top: PAD_Y, bottom: PAD_Y }
          return <ReadMark key={key} mark={m} origin={inner} start={start} pad={pad} />
        })}
        {outline.above ? (
          <div className="ov-edge ov-edge--up">
            <span aria-hidden>↑</span> {outline.above} more to read
          </div>
        ) : null}
        {outline.below ? (
          <div className="ov-edge ov-edge--down">
            <span aria-hidden>↓</span> {outline.below} more to read
          </div>
        ) : null}
      </div>
      {(reads.length > 0 || elsewhere) && showsPage(frame, origin) ? (
        <div className="ov-outline__card" role="status">
          <span className="ov-outline__badge">
            {reads.length + (outline.above ?? 0) + (outline.below ?? 0)}
          </span>
          <span>
            {reads.length > 0 ? (
              <>
                <strong>
                  {reads.length === 1
                    ? 'Read the highlighted passage'
                    : `Read these ${reads.length} passages`}
                </strong>{' '}
                for {outline.subjectName}
                {outline.minutes ? ` · about ${outline.minutes} min` : ''}.
              </>
            ) : (
              <strong>What to read for {outline.subjectName} is further on.</strong>
            )}
            {elsewhere ? <span className="ov-outline__summary"> {elsewhere}</span> : null}
            {reads.some((m) => m.why) ? (
              <span className="ov-outline__whys">
                {reads.map((m) =>
                  m.why ? (
                    <span key={`${m.order}|${m.why}`} className="ov-outline__why">
                      {m.order ? <span className="ov-outline__n">{m.order}</span> : null}
                      {m.why}
                    </span>
                  ) : null,
                )}
              </span>
            ) : null}
          </span>
          <span className="ov-outline__hint">hold {TRIGGER_KEYS[triggerKey].short} to clear</span>
        </div>
      ) : null}
    </section>
  )
}
