/**
 * Outline marks over the page the student is reading: READ passages get a highlighter wash and
 * a margin chip saying why, SKIM passages a quiet bar, SKIP passages are faded out. Marks come
 * in global screen points; each overlay window (one per display) draws them relative to its own
 * origin, so a page spanning two displays is marked on both. Never takes clicks.
 */
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

function Mark({ mark, origin }: { mark: OutlineMark; origin: Origin }) {
  const pad = 3
  const style: CSSProperties = {
    left: mark.rect.x - origin.x - pad,
    top: mark.rect.y - origin.y - pad,
    width: mark.rect.width + pad * 2,
    height: mark.rect.height + pad * 2,
  }
  return (
    <div className="ov-mark" data-verdict={mark.verdict} style={style}>
      {mark.verdict !== 'skim' ? <span className="ov-mark__why">{mark.why}</span> : null}
    </div>
  )
}

export function OutlineMarks({
  outline,
  origin = windowOrigin(),
}: {
  outline: OutlineOverlay
  origin?: Origin
}) {
  return (
    <div className="ov-outline" aria-label={`Outline for ${outline.subjectName}`}>
      {outline.marks.map((m) => (
        <Mark key={`${m.rect.x},${m.rect.y},${m.verdict}`} mark={m} origin={origin} />
      ))}
      {outline.marks.length > 0 ? (
        <div className="ov-outline__card">
          <strong>Read the highlighted parts</strong> for {outline.subjectName}.{' '}
          <span className="ov-outline__summary">{outline.summary}</span>
          <span className="ov-outline__hint">esc clears</span>
        </div>
      ) : null}
    </div>
  )
}
