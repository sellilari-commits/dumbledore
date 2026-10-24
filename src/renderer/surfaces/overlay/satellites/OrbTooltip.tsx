/** Hover tooltip for the orb: "Dumbledore · right ⌥" (the key that does the same as a click). */
import { type Anchor, anchorStyle } from '../lib/layout'

export const TOOLTIP_ID = 'ov-orb-tip'

export function OrbTooltip({ anchor }: { anchor: Anchor }) {
  return (
    <div id={TOOLTIP_ID} role="tooltip" className="ov-sat ov-tip" style={anchorStyle(anchor)}>
      <span>Dumbledore</span>
      <span className="ov-tip__key">· right ⌥</span>
    </div>
  )
}
