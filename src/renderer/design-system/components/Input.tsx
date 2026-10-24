/** Text inputs: Input, Textarea and Field (label + control + hint/error). */
import { type ComponentProps, type ReactNode, useId } from 'react'
import { cx } from '../cx'
import '../styles/controls.css'

export interface InputProps extends ComponentProps<'input'> {
  inputSize?: 'md' | 'lg'
  invalid?: boolean
}

export function Input({ inputSize = 'md', invalid, className, ...rest }: InputProps) {
  return (
    <input
      className={cx('dd-input', inputSize === 'lg' && 'dd-input--lg', className)}
      aria-invalid={invalid || undefined}
      {...rest}
    />
  )
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea className={cx('dd-textarea', className)} {...rest} />
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  error?: ReactNode
  className?: string
  /** Render prop receives the id to put on the control. */
  children: (id: string) => ReactNode
}

export function Field({ label, hint, error, className, children }: FieldProps) {
  const id = useId()
  return (
    <div className={cx('dd-field', className)}>
      <label className="dd-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {error ? (
        <div className="dd-field__error" role="alert">
          {error}
        </div>
      ) : hint ? (
        <div className="dd-field__hint">{hint}</div>
      ) : null}
    </div>
  )
}
