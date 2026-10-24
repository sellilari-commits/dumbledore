/**
 * The outline over the page the student is reading, made to read at a glance:
 *   · passages to READ get a highlighter stroke on each line that sweeps in left to right, one
 *     line after another, with a numbered badge (reading order) and the reason in the margin;
 *   · everything else is softly dimmed (a spotlight), and SKIP passages fade further;
 *   · SKIM passages get a quiet bar in the margin;
 *   · a small card at the bottom says how many passages, for which subject, about how long, on
 *     the display showing the page (a tap of the Dumbledore key clears it all).
 * Marks come in global screen points, clipped to the page's window; each overlay window (one per
 * display) draws them relative to its own origin. Never takes clicks.
 */
import { TRIGGER_KEYS } from '@renderer/pages/settings/keys'
import type { TriggerKey } from '@shared/domain'
import type { OutlineMark, OutlineOverlay } from '@shared/state'
import { type CSSProperties, useId } from 'react'
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
  return (
    <>
      {boxes.map((b, i) => {
        const p = local(b, origin)
        const style = {
          left: p.left - PAD_X,
          top: p.top - PAD_Y,
          width: p.width + PAD_X * 2,
          height: p.height + PAD_Y * 2,
          '--sweep-delay': `${start + i * STAGGER}ms`,
        } as CSSProperties
        return <span key={`${b.x},${b.y}`} className="ov-hl" style={style} />
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
    <div
      className="ov-skip"
      style={{ left: p.left - 6, top: p.top - 4, width: p.width + 12, height: p.height + 8 }}
    >
      <span className="ov-skip__why">{mark.why || 'Skip'}</span>
    </div>
  )
}

/** A soft wash over the page with holes where the passages to read are. */
function Spotlight({
  marks,
  origin,
  size,
}: {
  marks: OutlineMark[]
  origin: Origin
  size: { width: number; height: number }
}) {
  const id = `spot-${useId().replace(/[^a-zA-Z0-9]/g, '')}`
  const holes = marks
    .filter((m) => m.verdict === 'read')
    .flatMap((m) => (m.lines?.length ? m.lines : [m.rect]))
  return (
    <svg className="ov-spot" width={size.width} height={size.height} aria-hidden>
      <defs>
        <mask id={id}>
          <rect width="100%" height="100%" fill="white" />
          {holes.map((b) => {
            const p = local(b, origin)
            return (
              <rect
                key={`${b.x},${b.y}`}
                x={p.left - PAD_X - 2}
                y={p.top - PAD_Y - 2}
                width={p.width + (PAD_X + 2) * 2}
                height={p.height + (PAD_Y + 2) * 2}
                rx={4}
                fill="black"
              />
            )
          })}
        </mask>
      </defs>
      <rect width="100%" height="100%" className="ov-spot__wash" mask={`url(#${id})`} />
    </svg>
  )
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
  const size = frame ?? { width: window.innerWidth, height: window.innerHeight }
  const reads = outline.marks.filter((m) => m.verdict === 'read')
  let delay = 0
  return (
    <section className="ov-outline" aria-label={`Outline for ${outline.subjectName}`}>
      <div className="ov-outline__clip" style={clip}>
        {reads.length > 0 ? <Spotlight marks={outline.marks} origin={inner} size={size} /> : null}
        {outline.marks.map((m) => {
          const key = `${m.verdict},${m.rect.x},${m.rect.y}`
          if (m.verdict === 'skim') return <SkimMark key={key} mark={m} origin={inner} />
          if (m.verdict === 'skip') return <SkipMark key={key} mark={m} origin={inner} />
          const start = delay
          delay += (m.lines?.length ?? 1) * STAGGER + 120
          return <ReadMark key={key} mark={m} origin={inner} start={start} />
        })}
      </div>
      {reads.length > 0 && showsPage(frame, origin) ? (
        <div className="ov-outline__card" role="status">
          <span className="ov-outline__badge">{reads.length}</span>
          <span>
            <strong>
              {reads.length === 1
                ? 'Read the highlighted passage'
                : `Read these ${reads.length} passages`}
            </strong>{' '}
            for {outline.subjectName}
            {outline.minutes ? ` · about ${outline.minutes} min` : ''}.
            {outline.summary ? (
              <span className="ov-outline__summary"> {outline.summary}</span>
            ) : null}
          </span>
          <span className="ov-outline__hint">tap {TRIGGER_KEYS[triggerKey].short} to clear</span>
        </div>
      ) : null}
    </section>
  )
}
