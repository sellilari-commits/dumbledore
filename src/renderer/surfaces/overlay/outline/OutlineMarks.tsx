/**
 * The outline over the page the student is reading, calm enough to read through:
 *   · passages to READ get a soft translucent highlight on each line (fading in one line after
 *     another), a thin amber bar in the margin, and a small reading-order number with the reason;
 *   · SKIM passages get a thin grey margin line, SKIP passages a faint dashed one with the reason;
 *     the page itself is never dimmed or washed out;
 *   · a small card at the bottom says how many passages, for which subject, about how long, and
 *     how many more are further up or down (they light up when scrolled to), on the display
 *     showing the page; holding the Dumbledore key again clears it all.
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

const PAD_X = 3
const PAD_Y = 2
/** Delay between highlighted lines as they sweep in (ms). */
const STAGGER = 90

function local(r: { x: number; y: number; width: number; height: number }, o: Origin) {
  return { left: r.x - o.x, top: r.y - o.y, width: r.width, height: r.height }
}

function ReadMark({ mark, origin, start }: { mark: OutlineMark; origin: Origin; start: number }) {
  const boxes = mark.lines?.length ? mark.lines : [mark.rect]
  const first = boxes[0] ?? mark.rect
  const all = local(mark.rect, origin)
  return (
    <>
      <span
        className="ov-readbar"
        style={
          {
            left: all.left - 12,
            top: all.top - PAD_Y,
            height: all.height + PAD_Y * 2,
            '--sweep-delay': `${start}ms`,
          } as CSSProperties
        }
      />
      {boxes.map((b, i) => {
        const p = local(b, origin)
        const style = {
          left: p.left - PAD_X,
          top: p.top - PAD_Y,
          width: p.width + PAD_X * 2,
          height: p.height + PAD_Y * 2,
          '--sweep-delay': `${start + i * STAGGER}ms`,
        } as CSSProperties
        // biome-ignore lint/suspicious/noArrayIndexKey: a passage's lines keep their order as it scrolls
        return <span key={i} className="ov-hl" style={style} />
      })}
      <div
        className="ov-margin"
        style={
          {
            left: first.x - origin.x,
            top: first.y - origin.y + first.height / 2,
            '--sweep-delay': `${start}ms`,
          } as CSSProperties
        }
      >
        {mark.why ? <span className="ov-margin__why">{mark.why}</span> : null}
        {mark.order ? <span className="ov-margin__num">{mark.order}</span> : null}
      </div>
    </>
  )
}

function SkimMark({ mark, origin }: { mark: OutlineMark; origin: Origin }) {
  const p = local(mark.rect, origin)
  return <span className="ov-skim" style={{ left: p.left - 10, top: p.top, height: p.height }} />
}

function SkipMark({ mark, origin }: { mark: OutlineMark; origin: Origin }) {
  const p = local(mark.rect, origin)
  return (
    <div className="ov-skip" style={{ left: p.left - 12, top: p.top, height: p.height }}>
      <span className="ov-skip__why">{mark.why || 'Skip'}</span>
    </div>
  )
}

/** Where the passages that aren't on screen are, for the card. */
export function elsewhereText(above: number, below: number): string {
  const n = (k: number) => (k === 1 ? '1 more passage' : `${k} more passages`)
  if (below > 0 && above > 0)
    return `${n(above + below)} further up and down light up as you scroll.`
  if (below > 0)
    return `↓ ${n(below)} further down — ${below === 1 ? 'it lights' : 'they light'} up as you scroll.`
  if (above > 0)
    return `↑ ${n(above)} further up — ${above === 1 ? 'it lights' : 'they light'} up as you scroll.`
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
          delay += (m.lines?.length ?? 1) * STAGGER + 120
          return <ReadMark key={key} mark={m} origin={inner} start={start} />
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
            {outline.summary && reads.length > 0 && !elsewhere ? (
              <span className="ov-outline__summary"> {outline.summary}</span>
            ) : null}
          </span>
          <span className="ov-outline__hint">hold {TRIGGER_KEYS[triggerKey].short} to clear</span>
        </div>
      ) : null}
    </section>
  )
}
