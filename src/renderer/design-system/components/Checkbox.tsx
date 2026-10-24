/** Checkbox: Notion's square to-do box (blue with a white tick when checked). */
import { Check } from 'lucide-react'
import { cx } from '../cx'
import '../styles/controls.css'

export interface CheckboxProps {
  checked: boolean
  onCheckedChange?: (checked: boolean) => void
  label: string
  disabled?: boolean
  className?: string
}

export function Checkbox({ checked, onCheckedChange, label, disabled, className }: CheckboxProps) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled || !onCheckedChange}
      className={cx('dd-checkbox', className)}
      onClick={() => onCheckedChange?.(!checked)}
    >
      {checked ? <Check size={12} strokeWidth={3} aria-hidden /> : null}
    </button>
  )
}
