/**
 * EmojiPicker: a small grid of subject emoji (Notion's "Change icon"), anchored to the page
 * icon — PageHeader renders that icon as a button (onIconClick + iconRef). Picking one calls
 * onChange and closes the popover; focus goes back to the icon.
 */
import { Popover } from '@renderer/design-system'
import type { RefObject } from 'react'

/** Study-flavoured emoji, eight to a row in the grid. */
const EMOJI = [
  '🧪 ⚗️ 🧬 🔬 🔭 ⚛️ 🧲 🦠 📐 📏 🧮 📊 📈 💻 ⚙️ 🤖',
  '🌍 🗺️ 🌋 🌊 🌱 🌿 🪐 ☀️ 📘 📗 📕 📙 📓 📜 ✏️ 📝',
  '🏛️ ⚖️ 💼 💰 🩺 🧠 🗣️ 🎓 🎨 🎵 🎭 📷 ♟️ 🏃 💡 ⭐',
]
  .join(' ')
  .split(' ')

export interface EmojiPickerProps {
  /** The page icon button the grid opens under. */
  anchor: RefObject<HTMLElement | null>
  open: boolean
  onOpenChange: (open: boolean) => void
  value: string
  onChange: (emoji: string) => void
}

export function EmojiPicker({ anchor, open, onOpenChange, value, onChange }: EmojiPickerProps) {
  return (
    <Popover
      anchor={anchor}
      open={open}
      onOpenChange={onOpenChange}
      label="Choose an icon"
      className="sp-emoji-pop"
    >
      <div className="sp-emoji-pop__head">Icon</div>
      <div className="sp-emoji-grid">
        {EMOJI.map((e) => (
          <button
            key={e}
            type="button"
            className="sp-emoji"
            aria-label={`Use ${e}`}
            aria-pressed={e === value}
            onClick={() => {
              onOpenChange(false)
              if (e !== value) onChange(e)
            }}
          >
            {e}
          </button>
        ))}
      </div>
    </Popover>
  )
}
