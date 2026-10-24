/**
 * EditableText: Notion-style click-to-edit text (page title, Goal property). Shows the text as a
 * quiet button; editing swaps in an input with the same metrics (caret at the end). Enter or
 * blur saves, Esc cancels. Empty input saves '' only when `allowEmpty` is set.
 */
import { cx } from '@renderer/design-system'
import { type KeyboardEvent, useLayoutEffect, useRef, useState } from 'react'

export interface EditableTextProps {
  value: string
  onSave: (next: string) => void
  /** Accessible name of the input, e.g. "Subject name". */
  label: string
  placeholder?: string
  allowEmpty?: boolean
  className?: string
}

export function EditableText({
  value,
  onSave,
  label,
  placeholder = 'Empty',
  allowEmpty = false,
  className,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const input = useRef<HTMLInputElement>(null)
  const done = useRef(false)

  // Focus before paint with the caret at the end (a click means "fix something", not "retype").
  useLayoutEffect(() => {
    const el = input.current
    if (!editing || !el) return
    el.focus()
    el.setSelectionRange(el.value.length, el.value.length)
  }, [editing])

  const start = () => {
    setDraft(value)
    done.current = false
    setEditing(true)
  }

  const finish = (save: boolean) => {
    if (done.current) return
    done.current = true
    setEditing(false)
    const next = draft.trim()
    if (!save || next === value.trim()) return
    if (next || allowEmpty) onSave(next)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      finish(true)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      finish(false)
    }
  }

  if (editing)
    return (
      <input
        ref={input}
        className={cx('sp-edit sp-edit--input', className)}
        aria-label={label}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => finish(true)}
        onKeyDown={onKeyDown}
      />
    )

  return (
    <button
      type="button"
      className={cx('sp-edit', !value && 'sp-edit--empty', className)}
      title={`Edit ${label.toLowerCase()}`}
      onClick={start}
    >
      {value || placeholder}
    </button>
  )
}
