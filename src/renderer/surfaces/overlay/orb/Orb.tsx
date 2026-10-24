/**
 * The orb: a 40 pt circle (28 pt when docked) with the spectacles glyph. Status shows as glyphs
 * on it, Goldfish-style — pause bars, a rotating blue arc while thinking, a 2 px progress ring
 * during a session and an 8 pt dot when something is waiting. Gestures come from the parent
 * (click, long press, drag, right-click); position changes glide via CSS transitions.
 */
import type { OverlayState } from '@shared/state'
import { SpectaclesGlyph } from '../glyph/SpectaclesGlyph'
import type { Gesture, Point } from '../lib/usePointerGesture'
import { type OrbLook, orbLabel } from './orbLook'
import './orb.css'

interface Props {
  orb: OverlayState['orb']
  look: OrbLook
  center: Point
  gesture: Gesture
  /** Keyboard activation (Enter/Space) — pointer clicks come through the gesture. */
  onActivate: () => void
  onHoverChange: (hovering: boolean) => void
  tooltipId?: string
}

export function Orb({ orb, look, center, gesture, onActivate, onHoverChange, tooltipId }: Props) {
  const { size } = look
  return (
    <div
      className="ov-orb"
      data-hit=""
      data-testid="orb"
      data-docked={look.docked || undefined}
      data-paused={look.paused || undefined}
      data-thinking={look.thinking || undefined}
      data-pressed={gesture.pressed || undefined}
      style={{
        width: size,
        height: size,
        transform: `translate3d(${center.x - size / 2}px, ${center.y - size / 2}px, 0)`,
      }}
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
    >
      <div className="ov-orb__body">
        <button
          type="button"
          className="ov-orb__face"
          aria-label={orbLabel(look, orb)}
          aria-describedby={tooltipId}
          {...gesture.bind}
          onClick={(e) => {
            // detail 0 = keyboard activation; pointer clicks are handled by the gesture.
            if (e.detail === 0) onActivate()
          }}
        >
          <SpectaclesGlyph className="ov-orb__glyph" size={Math.round(size * 0.56)} />
        </button>
        {look.progress !== null && <ProgressRing size={size} value={look.progress} />}
        {look.thinking && <ThinkingArc size={size} />}
        {look.paused && (
          <span className="ov-orb__pause" data-testid="orb-paused" aria-hidden>
            <i />
            <i />
          </span>
        )}
        {look.dot !== 'none' && (
          <span className="ov-orb__dot" data-color={look.dot} data-testid="orb-dot" aria-hidden />
        )}
      </div>
    </div>
  )
}

const STROKE = 2

function ProgressRing({ size, value }: { size: number; value: number }) {
  const r = size / 2 - STROKE / 2
  const c = 2 * Math.PI * r
  return (
    <svg
      className="ov-orb__ring"
      data-testid="orb-ring"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        className="ov-orb__ring-value"
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - value)}
      />
    </svg>
  )
}

function ThinkingArc({ size }: { size: number }) {
  const r = size / 2 - STROKE / 2
  const c = 2 * Math.PI * r
  return (
    <svg
      className="ov-orb__think"
      data-testid="orb-thinking"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      aria-hidden
    >
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        strokeWidth={STROKE}
        strokeLinecap="round"
        strokeDasharray={`${c * 0.28} ${c}`}
      />
    </svg>
  )
}
