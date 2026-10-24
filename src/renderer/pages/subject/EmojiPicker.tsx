/**
 * EmojiPicker: the 78 px page icon as a button that opens a small grid of subject emoji
 * (Notion's "Change icon"). Picking one calls onChange and closes the popover.
 */
import { Popover } from '@renderer/design-system'
import { useState } from 'react'

/** Study-flavoured emoji, eight to a row in the grid. */
const EMOJI = [
  '🧪 ⚗️ 🧬 🔬 🔭 ⚛️ 🧲 🦠 📐 📏 🧮 📊 📈 💻 ⚙️ 🤖',
  '🌍 🗺️ 🌋 🌊 🌱 🌿 🪐 ☀️ 📘 📗 📕 📙 📓 📜 ✏️ 📝',
  '🏛️ ⚖️ 💼 💰 🩺 🧠 🗣️ 🎓 🎨 🎵 🎭 📷 ♟️ 🏃 💡 ⭐',
]
  .join(' ')
  .split(' ')

export interface EmojiPickerProps {
  value: string
  onChange: (emoji: string) => void
}

export function EmojiPicker({ value, onChange }: EmojiPickerProps) {
  const [open, setOpen] = useState(false)
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      label="Choose an icon"
      className="sp-emoji-pop"
      trigger={
        <button
          type="button"
          className="dd-page-header__icon sp-icon"
          aria-label="Change icon"
          title="Change icon"
        >
          {value}
        </button>
      }
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
              setOpen(false)
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
