/**
 * Suggestion chip beside the docked orb. Empty chat box: "✨ <first ~50 chars of the suggested
 * prompt> ⌥". Typed text: "Improve prompt · ⌥". Click (or right ⌥) inserts / rewrites.
 */
import type { OverlayState } from '@shared/state'
import { type Anchor, anchorStyle } from '../lib/layout'
import './satellites.css'

interface Props {
  chip: NonNullable<OverlayState['chip']>
  anchor: Anchor
  onClick: () => void
}

export const CHIP_CHARS = 50

/** First ~50 characters, cut at a word boundary when one is close, plus an ellipsis. */
export function previewText(text: string, max = CHIP_CHARS): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max)
  const space = cut.lastIndexOf(' ')
  const head = space >= max * 0.6 ? cut.slice(0, space) : cut
  return `${head.replace(/[\s,.;:!?–—-]+$/, '')}…`
}

export function SuggestionChip({ chip, anchor, onClick }: Props) {
  const improve = chip.kind === 'improve'
  const text = improve ? 'Improve prompt' : previewText(chip.text)
  return (
    <button
      type="button"
      className="ov-sat ov-chip"
      data-hit=""
      data-kind={chip.kind}
      data-testid="suggestion-chip"
      title={improve ? undefined : chip.text}
      aria-label={improve ? 'Improve prompt (right Option)' : `Insert prompt: ${chip.text}`}
      style={anchorStyle(anchor)}
      onClick={onClick}
    >
      {!improve && (
        <span className="ov-chip__spark" aria-hidden>
          ✨
        </span>
      )}
      <span className="ov-chip__text">{text}</span>
      {improve && (
        <span className="ov-pill__sep" aria-hidden>
          ·
        </span>
      )}
      <kbd className="ov-key" aria-hidden>
        ⌥
      </kbd>
    </button>
  )
}
