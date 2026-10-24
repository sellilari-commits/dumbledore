/**
 * Hover tooltip for the orb: "Dumbledore · right ⌥ · tap: prompt · hold: tell it what you want, it
 * writes the prompt · double-tap: chat". A tap of the key does the same as a click (the prompt: for
 * what you studied last, the next step, or yours rewritten); a hold opens the prompt box (tell
 * Dumbledore what you want, it writes the prompt); a double-tap opens the chat.
 */
import { type Anchor, anchorStyle } from '../lib/layout'

export const TOOLTIP_ID = 'ov-orb-tip'

export function OrbTooltip({ anchor }: { anchor: Anchor }) {
  return (
    <div id={TOOLTIP_ID} role="tooltip" className="ov-sat ov-tip" style={anchorStyle(anchor)}>
      <span>Dumbledore</span>
      <span className="ov-tip__key">
        · right ⌥ · tap: prompt · hold: tell it what you want, it writes the prompt · double-tap:
        chat
      </span>
    </div>
  )
}
