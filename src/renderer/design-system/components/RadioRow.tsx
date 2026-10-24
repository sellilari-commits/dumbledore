/**
 * RadioGroup + RadioRow: full-width option rows (quiz answers, exam focus, settings choices).
 * Arrow keys move between rows; a tone marks a revealed answer correct (green) or wrong (red).
 */
import { CircleCheck, CircleX } from 'lucide-react'
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { cx } from '../cx'
import '../styles/controls.css'

export type RadioTone = 'correct' | 'wrong' | 'muted'

export interface RadioRowProps {
  checked: boolean
  onSelect?: () => void
  children: ReactNode
  hint?: ReactNode
  tone?: RadioTone
  disabled?: boolean
  /** Keyboard hint on the right, e.g. "1". */
  keyHint?: string
  className?: string
}

export function RadioRow({
  checked,
  onSelect,
  children,
  hint,
  tone,
  disabled,
  keyHint,
  className,
}: RadioRowProps) {
  const icon =
    tone === 'correct' ? (
      <CircleCheck size={16} aria-hidden />
    ) : tone === 'wrong' ? (
      <CircleX size={16} aria-hidden />
    ) : null
  return (
    // biome-ignore lint/a11y/useSemanticElements: full-width option rows, styled buttons with radio semantics
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      data-tone={tone}
      disabled={disabled}
      tabIndex={checked ? 0 : -1}
      className={cx('dd-radio-row', className)}
      onClick={onSelect}
    >
      <span className="dd-radio-row__dot">{icon}</span>
      <span className="dd-radio-row__body">
        <span>{children}</span>
        {hint ? <span className="dd-radio-row__hint">{hint}</span> : null}
      </span>
      {keyHint ? <span className="dd-radio-row__key">{keyHint}</span> : null}
    </button>
  )
}

export interface RadioGroupProps {
  label: string
  children: ReactNode
  className?: string
}

/** Wraps RadioRows with roving focus: ↑/↓ move and select like native radios. */
export function RadioGroup({ label, children, className }: RadioGroupProps) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'ArrowRight', 'ArrowLeft'].includes(e.key)) return
    const rows = Array.from(
      ref.current?.querySelectorAll<HTMLButtonElement>('[role="radio"]:not(:disabled)') ?? [],
    )
    if (rows.length === 0) return
    const current = rows.indexOf(document.activeElement as HTMLButtonElement)
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1
    const next = rows[(current + step + rows.length) % rows.length]
    e.preventDefault()
    next?.focus()
    next?.click()
  }
  return (
    <div
      ref={ref}
      role="radiogroup"
      aria-label={label}
      className={cx('dd-radio-group', className)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  )
}
