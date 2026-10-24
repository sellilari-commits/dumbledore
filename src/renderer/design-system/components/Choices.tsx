/** Choices: a compact single-choice chip group (e.g. 5 / 10 / 20 questions, difficulty). */
import { cx } from '../cx'
import '../styles/controls.css'

export interface ChoicesProps<T extends string | number> {
  label: string
  value: T
  options: ReadonlyArray<{ value: T; label: string }>
  onChange: (value: T) => void
  className?: string
}

export function Choices<T extends string | number>({
  label,
  value,
  options,
  onChange,
  className,
}: ChoicesProps<T>) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('dd-choices', className)}>
      {options.map((o) => (
        // biome-ignore lint/a11y/useSemanticElements: segmented-control chips, styled buttons with radio semantics
        <button
          key={String(o.value)}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className="dd-choice"
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}
