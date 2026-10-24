/**
 * Buttons: Button (primary blue · secondary outline · ghost · danger) and IconButton (square,
 * icon only, always labelled for screen readers and tooltips).
 */
import type { ComponentProps, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/controls.css'
import { Spinner } from './Spinner'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

export interface ButtonProps extends ComponentProps<'button'> {
  variant?: ButtonVariant
  size?: 'xs' | 'sm' | 'md'
  icon?: ReactNode
  iconRight?: ReactNode
  loading?: boolean
  /** Shortcut hint shown after the label, e.g. "⌘E". */
  shortcut?: string
  block?: boolean
}

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconRight,
  loading = false,
  shortcut,
  block,
  className,
  children,
  disabled,
  type = 'button',
  ...rest
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cx(
        'dd-btn',
        `dd-btn--${variant}`,
        size !== 'md' && `dd-btn--${size}`,
        block && 'dd-btn--block',
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner size={14} /> : icon}
      {children}
      {iconRight}
      {shortcut ? <span className="dd-btn__shortcut">{shortcut}</span> : null}
    </button>
  )
}

export interface IconButtonProps extends ComponentProps<'button'> {
  /** Accessible name; also used as the native tooltip when no Tooltip wraps it. */
  label: string
  size?: 'sm' | 'md'
}

export function IconButton({
  label,
  size = 'md',
  className,
  children,
  type = 'button',
  ...rest
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={cx('dd-icon-btn', size === 'sm' && 'dd-icon-btn--sm', className)}
      {...rest}
    >
      {children}
    </button>
  )
}
