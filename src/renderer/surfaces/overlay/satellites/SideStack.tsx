/**
 * Side stack: 28 pt rounded squares under the orb during a study session — ▸ Next (its "3/8"
 * label shows on hover) and Quiz when a checkpoint is next. Long press opens the Ask bar, like
 * the orb. Opens toward the screen (see layout.stackAnchor).
 */
import type { OverlayAction, OverlayState } from '@shared/state'
import { ListChecks } from 'lucide-react'
import type { ReactNode } from 'react'
import { type Anchor, anchorStyle, type Side } from '../lib/layout'
import { usePointerGesture } from '../lib/usePointerGesture'
import './satellites.css'

interface Props {
  side: OverlayState['side']
  anchor: Anchor & { side: Side }
  up: boolean
  send: (action: OverlayAction) => void
}

export function SideStack({ side, anchor, up, send }: Props) {
  const longPress = () => send({ type: 'orbLongPress' })
  return (
    <div
      className="ov-sat ov-stack"
      data-side={anchor.side}
      data-up={up || undefined}
      style={anchorStyle(anchor)}
    >
      {side.next && (
        <StackButton
          label={side.next.label}
          ariaLabel={`Next step (${side.next.label})`}
          testId="side-next"
          onClick={() => send({ type: 'sideNext' })}
          onLongPress={longPress}
        >
          <NextGlyph />
        </StackButton>
      )}
      {side.quiz && (
        <StackButton
          label="Checkpoint quiz"
          ariaLabel="Checkpoint quiz"
          testId="side-quiz"
          onClick={() => send({ type: 'sideQuiz' })}
          onLongPress={longPress}
        >
          <ListChecks size={15} strokeWidth={1.75} aria-hidden />
        </StackButton>
      )}
    </div>
  )
}

interface ButtonProps {
  label: string
  ariaLabel: string
  testId: string
  onClick: () => void
  onLongPress: () => void
  children: ReactNode
}

function StackButton({ label, ariaLabel, testId, onClick, onLongPress, children }: ButtonProps) {
  const gesture = usePointerGesture({ x: 0, y: 0 }, { onClick, onLongPress })
  return (
    <button
      type="button"
      className="ov-sq"
      data-hit=""
      data-testid={testId}
      data-pressed={gesture.pressed || undefined}
      aria-label={ariaLabel}
      {...gesture.bind}
      onClick={(e) => {
        if (e.detail === 0) onClick()
      }}
    >
      {children}
      <span className="ov-sq__label" aria-hidden>
        {label}
      </span>
    </button>
  )
}

/** ▸ — a small solid triangle, optically centred. */
function NextGlyph() {
  return (
    <svg width="8" height="10" viewBox="0 0 10 12" aria-hidden>
      <path
        d="M2 1.6v8.8a.8.8 0 0 0 1.22.68l6.7-4.4a.8.8 0 0 0 0-1.36l-6.7-4.4A.8.8 0 0 0 2 1.6Z"
        fill="currentColor"
      />
    </svg>
  )
}
