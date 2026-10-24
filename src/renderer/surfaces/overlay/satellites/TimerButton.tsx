/**
 * The timer square under the orb. Idle, a click opens a small chooser beside it (5 / 15 / 25 / 45
 * / 60 min or a custom length, 1–180) and picking one starts the timer; a right click starts the
 * length picked last at once. Running, the square shows the minutes left and a click stops it.
 * Main owns the timer, remembers the length and sends a macOS notification when it runs out.
 * Long press opens the Ask bar, like the orb. The overlay window never takes keyboard focus, so
 * the custom length is a stepper (− / + and the scroll wheel), not a text field.
 */
import type { OverlayState } from '@shared/state'
import { Minus, Plus, Timer } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { type Anchor, anchorStyle, type Side } from '../lib/layout'
import { usePointerGesture } from '../lib/usePointerGesture'
import './satellites.css'

const TICK_MS = 1000
/** The chooser closes this long after the pointer leaves it and the square. */
const CLOSE_AFTER_MS = 1200
export const TIMER_PRESETS = [5, 15, 25, 45, 60] as const
export const MIN_MINUTES = 1
export const MAX_MINUTES = 180

interface Props {
  timer: OverlayState['timer']
  /** The length picked last; the chooser starts from it. */
  minutes: number
  anchor: Anchor & { side: Side }
  up: boolean
  onStart: (minutes: number) => void
  onStop: () => void
  onLongPress: () => void
}

/** Whole minutes left, rounded up so "1" shows until the end. */
export function minutesLeft(endsAt: string, now: number): number {
  return Math.max(0, Math.ceil((Date.parse(endsAt) - now) / 60_000))
}

/** One stepper step: by 1 up to 10 minutes, then by 5, kept within 1–180. */
export function stepMinutes(value: number, direction: 1 | -1): number {
  const step = (direction === 1 ? value < 10 : value <= 10) ? 1 : 5
  const next = direction === 1 ? value + step : value - step
  const snapped = step === 5 ? Math.round(next / 5) * 5 : next
  return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, snapped))
}

export function TimerButton({ timer, minutes, anchor, up, onStart, onStop, onLongPress }: Props) {
  const now = useNow(timer !== null)
  const [open, setOpen] = useState(false)
  const close = useCloseLater(() => setOpen(false))
  const running = timer !== null
  useEffect(() => {
    if (running) setOpen(false)
  }, [running])
  const gesture = usePointerGesture(
    { x: 0, y: 0 },
    {
      onClick: () => (running ? onStop() : setOpen((o) => !o)),
      onLongPress,
      onContextMenu: () => {
        if (!running) onStart(minutes)
      },
    },
  )
  const left = timer ? minutesLeft(timer.endsAt, now) : null
  const label =
    left === null ? `Timer · right click: ${minutes} min` : `${left} min left · click to stop`
  const start = (m: number) => {
    setOpen(false)
    onStart(m)
  }
  return (
    <div
      className="ov-sat ov-stack"
      data-side={anchor.side}
      data-up={up || undefined}
      style={anchorStyle(anchor)}
      onPointerLeave={close.later}
      onPointerEnter={close.cancel}
    >
      <button
        type="button"
        className="ov-sq"
        data-hit=""
        data-testid="timer"
        data-running={left !== null || undefined}
        data-open={open || undefined}
        data-pressed={gesture.pressed || undefined}
        aria-label={left === null ? 'Set a timer' : label}
        aria-expanded={left === null ? open : undefined}
        {...gesture.bind}
        onClick={(e) => {
          if (e.detail === 0) (running ? onStop : () => setOpen((o) => !o))()
        }}
      >
        {left === null ? (
          <Timer size={15} strokeWidth={1.75} aria-hidden />
        ) : (
          <span className="ov-sq__count">{left}</span>
        )}
        {!open && (
          <span className="ov-sq__label" aria-hidden>
            {label}
          </span>
        )}
      </button>
      {open && !running && (
        <TimerChooser minutes={minutes} onStart={start} onClose={() => setOpen(false)} />
      )}
    </div>
  )
}

function TimerChooser({
  minutes,
  onStart,
  onClose,
}: {
  minutes: number
  onStart: (minutes: number) => void
  onClose: () => void
}) {
  const [custom, setCustom] = useState(minutes)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    // biome-ignore lint/a11y/useSemanticElements: a floating group of buttons, not a form
    <div
      className="ov-timer"
      data-hit=""
      data-testid="timer-chooser"
      role="group"
      aria-label="Timer length"
    >
      {TIMER_PRESETS.map((m) => (
        <button
          key={m}
          type="button"
          className="ov-timer__opt"
          data-current={m === minutes || undefined}
          onClick={() => onStart(m)}
        >
          {m} min
        </button>
      ))}
      <div
        className="ov-timer__custom"
        onWheel={(e) => setCustom((v) => stepMinutes(v, e.deltaY < 0 ? 1 : -1))}
      >
        <button
          type="button"
          className="ov-timer__step"
          aria-label="Shorter"
          disabled={custom <= MIN_MINUTES}
          onClick={() => setCustom((v) => stepMinutes(v, -1))}
        >
          <Minus size={12} strokeWidth={2} aria-hidden />
        </button>
        <button
          type="button"
          className="ov-timer__opt ov-timer__value"
          data-testid="timer-custom"
          aria-label={`Custom: ${custom} min`}
          onClick={() => onStart(custom)}
        >
          {custom} min
        </button>
        <button
          type="button"
          className="ov-timer__step"
          aria-label="Longer"
          disabled={custom >= MAX_MINUTES}
          onClick={() => setCustom((v) => stepMinutes(v, 1))}
        >
          <Plus size={12} strokeWidth={2} aria-hidden />
        </button>
      </div>
    </div>
  )
}

/** Closes after a short delay once the pointer has left, unless it comes back. */
function useCloseLater(close: () => void): { later: () => void; cancel: () => void } {
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  return {
    later: () => {
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(close, CLOSE_AFTER_MS)
    },
    cancel: () => window.clearTimeout(timer.current),
  }
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
