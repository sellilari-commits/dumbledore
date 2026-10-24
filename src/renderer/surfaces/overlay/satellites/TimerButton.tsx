/**
 * The timer square under the orb: idle it shows a timer glyph ("Start 25-min timer"); running it
 * shows the minutes left, and a click stops it. Main owns the timer and sends a macOS
 * notification when it runs out. Long press opens the Ask bar, like the orb. Opens toward the
 * screen (see layout.stackAnchor).
 */
import type { OverlayState } from '@shared/state'
import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import { type Anchor, anchorStyle, type Side } from '../lib/layout'
import { usePointerGesture } from '../lib/usePointerGesture'
import './satellites.css'

const TICK_MS = 1000

interface Props {
  timer: OverlayState['timer']
  anchor: Anchor & { side: Side }
  up: boolean
  onClick: () => void
  onLongPress: () => void
}

/** Whole minutes left, rounded up so "1" shows until the end. */
export function minutesLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60_000))
}

export function TimerButton({ timer, anchor, up, onClick, onLongPress }: Props) {
  const now = useNow(timer !== null)
  const gesture = usePointerGesture({ x: 0, y: 0 }, { onClick, onLongPress })
  const left = timer ? minutesLeft(timer.endsAt, now) : null
  const label = left === null ? 'Start 25-min timer' : `${left} min left · click to stop`
  return (
    <div
      className="ov-sat ov-stack"
      data-side={anchor.side}
      data-up={up || undefined}
      style={anchorStyle(anchor)}
    >
      <button
        type="button"
        className="ov-sq"
        data-hit=""
        data-testid="timer"
        data-running={left !== null || undefined}
        data-pressed={gesture.pressed || undefined}
        aria-label={label}
        {...gesture.bind}
        onClick={(e) => {
          if (e.detail === 0) onClick()
        }}
      >
        {left === null ? (
          <Timer size={15} strokeWidth={1.75} aria-hidden />
        ) : (
          <span className="ov-sq__count">{left}</span>
        )}
        <span className="ov-sq__label" aria-hidden>
          {label}
        </span>
      </button>
    </div>
  )
}

/** The current time, re-read every second while `active`. */
function useNow(active: boolean): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return
    setNow(Date.now())
    const id = setInterval(() => setNow(Date.now()), TICK_MS)
    return () => clearInterval(id)
  }, [active])
  return now
}
