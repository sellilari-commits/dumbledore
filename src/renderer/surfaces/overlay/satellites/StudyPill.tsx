/** Study pill beside the orb while an AI chat is open and no session runs: "Study · 4". */
import type { OverlayState } from '@shared/state'
import { type Anchor, anchorStyle } from '../lib/layout'
import './satellites.css'

interface Props {
  pill: NonNullable<OverlayState['pill']>
  anchor: Anchor
  onClick: () => void
}

export function StudyPill({ pill, anchor, onClick }: Props) {
  const label = pill.count > 0 ? `${pill.label}, ${pill.count} open study questions` : pill.label
  return (
    <button
      type="button"
      className="ov-sat ov-pill"
      data-hit=""
      data-testid="study-pill"
      aria-label={label}
      style={anchorStyle(anchor)}
      onClick={onClick}
    >
      <span>{pill.label}</span>
      {pill.count > 0 && (
        <>
          <span className="ov-pill__sep" aria-hidden>
            ·
          </span>
          <span className="ov-pill__count">{pill.count}</span>
        </>
      )}
    </button>
  )
}
