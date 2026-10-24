/**
 * Hover tooltip for the orb: "Dumbledore · right ⌥ · hold: rewrite or pick · double-tap: chat".
 * A tap of the key does the same as a click (study what you worked on last / next step); holding
 * it rewrites your prompt or offers the subjects; a double-tap opens the chat.
 */
import { type Anchor, anchorStyle } from '../lib/layout'

export const TOOLTIP_ID = 'ov-orb-tip'

export function OrbTooltip({ anchor }: { anchor: Anchor }) {
  return (
    <div id={TOOLTIP_ID} role="tooltip" className="ov-sat ov-tip" style={anchorStyle(anchor)}>
      <span>Dumbledore</span>
      <span className="ov-tip__key">· right ⌥ · hold: rewrite or pick · double-tap: chat</span>
    </div>
  )
}
