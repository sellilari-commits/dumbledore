/**
 * The timer square under the orb. Idle, a click opens a small chooser beside it (5 / 15 / 25 / 45
 * / 60 min or a custom length, 1–180) and picking one starts the timer; a right click starts the
 * length picked last at once. Running, the square shows the minutes left; a click opens a small
 * chooser to add or take off minutes (−5 / −1 / +1 / +5, never below one minute left) or stop it,
 * and a right click stops it at once. The chooser closes when the pointer leaves or after 5 s
 * without a click. Main owns the timer, remembers the length and sends a macOS notification.
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
/** The running timer's chooser closes after this long without a click. */
const RUNNING_IDLE_MS = 5000
export const TIMER_STEPS = [-5, -1, 1, 5] as const
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
  /** The running timer: add (or take off) minutes. */
  onAdjust: (deltaMinutes: number) => void
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

export function TimerButton({
  timer,
  minutes,
  anchor,
  up,
  onStart,
  onStop,
  onAdjust,
  onLongPress,
}: Props) {
  const now = useNow(timer !== null)
  const [open, setOpen] = useState(false)
  const close = useCloseLater(() => setOpen(false))
  const running = timer !== null
  // Starting or ending the timer closes whichever chooser was open.
  // biome-ignore lint/correctness/useExhaustiveDependencies: runs on every start and end
  useEffect(() => setOpen(false), [running])
  const toggle = () => setOpen((o) => !o)
  const gesture = usePointerGesture(
    { x: 0, y: 0 },
    {
      onClick: toggle,
      onLongPress,
      onContextMenu: () => (running ? onStop() : onStart(minutes)),
    },
  )
  const left = timer ? minutesLeft(timer.endsAt, now) : null
  const label =
    left === null ? `Timer · right click: ${minutes} min` : `${left} min left · click to change`
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
        aria-expanded={open}
        {...gesture.bind}
        onClick={(e) => {
          if (e.detail === 0) toggle()
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
      {open && left !== null && (
        <RunningChooser
          left={left}
          onAdjust={onAdjust}
          onStop={() => {
            setOpen(false)
            onStop()
          }}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  )
}

/** The running timer: minutes left, −5 / −1 / +1 / +5 and Stop. Closes after 5 s untouched. */
function RunningChooser({
  left,
  onAdjust,
  onStop,
  onClose,
}: {
  left: number
  onAdjust: (deltaMinutes: number) => void
  onStop: () => void
  onClose: () => void
}) {
  const [touched, setTouched] = useState(0)
  // biome-ignore lint/correctness/useExhaustiveDependencies: each click restarts the 5 s wait
  useEffect(() => {
    const id = window.setTimeout(onClose, RUNNING_IDLE_MS)
    return () => window.clearTimeout(id)
  }, [onClose, touched])
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
      className="ov-timer ov-timer--running"
      data-hit=""
      data-testid="timer-running"
      role="group"
      aria-label="Change the timer"
    >
      <div className="ov-timer__left" data-testid="timer-left">
        {left} min left
      </div>
      <div className="ov-timer__steps">
        {TIMER_STEPS.map((d) => (
          <button
            key={d}
            type="button"
            className="ov-timer__opt ov-timer__delta"
            aria-label={d > 0 ? `Add ${d} min` : `Take off ${-d} min`}
            disabled={d < 0 && left <= 1}
            onClick={() => {
              setTouched((n) => n + 1)
              onAdjust(d)
            }}
          >
            {d > 0 ? `+${d}` : `−${-d}`}
          </button>
        ))}
      </div>
      <button type="button" className="ov-timer__opt ov-timer__stop" onClick={onStop}>
        Stop
      </button>
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
