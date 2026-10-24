/**
 * Feedback states every page needs: Divider, Skeleton, LoadingState (skeleton lines
 * with specific copy — "Reading your notes on SN1…"), EmptyState and ErrorState.
 */
import type { CSSProperties, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/display.css'
import { Button } from './Button'
import { SpectaclesGlyph } from './SpectaclesGlyph'
import { Spinner } from './Spinner'

export function Divider({ vertical, className }: { vertical?: boolean; className?: string }) {
  return (
    <hr
      className={cx('dd-divider', vertical && 'dd-divider--vertical', className)}
      aria-orientation={vertical ? 'vertical' : 'horizontal'}
    />
  )
}

export function Skeleton({
  width = '100%',
  height = 14,
  radius,
  className,
}: {
  width?: number | string
  height?: number
  radius?: number
  className?: string
}) {
  const style: CSSProperties = { width, height, borderRadius: radius }
  return <span className={cx('dd-skeleton', className)} style={style} aria-hidden />
}

export interface LoadingStateProps {
  /** Specific copy about what is happening, e.g. "Loading your subjects…". */
  caption: string
  lines?: number
  /** Optional custom skeleton shape instead of text lines. */
  children?: ReactNode
  className?: string
}

const WIDTHS = ['92%', '78%', '85%', '64%', '88%', '72%']

export function LoadingState({ caption, lines = 4, children, className }: LoadingStateProps) {
  return (
    <div className={cx('dd-loading', className)} role="status" aria-live="polite">
      <div className="dd-loading__caption">
        <Spinner size={14} />
        <span>{caption}</span>
      </div>
      {children ??
        Array.from({ length: lines }, (_, i) => (
          // biome-ignore lint/suspicious/noArrayIndexKey: static placeholder list
          <Skeleton key={i} width={WIDTHS[i % WIDTHS.length]} height={14} />
        ))}
    </div>
  )
}

export interface EmptyStateProps {
  /** Defaults to Dumbledore's mark on full-size, centred empty states. */
  icon?: ReactNode
  title: string
  children?: ReactNode
  actions?: ReactNode
  compact?: boolean
  align?: 'center' | 'left'
  className?: string
}

export function EmptyState({
  icon,
  title,
  children,
  actions,
  compact,
  align = 'center',
  className,
}: EmptyStateProps) {
  const shownIcon = icon ?? (compact || align === 'left' ? null : <SpectaclesGlyph size={36} />)
  return (
    <div
      className={cx(
        'dd-empty',
        compact && 'dd-empty--compact',
        align === 'left' && 'dd-empty--left',
        className,
      )}
    >
      {shownIcon ? (
        <div className="dd-empty__icon" aria-hidden>
          {shownIcon}
        </div>
      ) : null}
      <div className="dd-empty__title">{title}</div>
      {children ? <div className="dd-empty__body">{children}</div> : null}
      {actions ? <div className="dd-empty__actions">{actions}</div> : null}
    </div>
  )
}

export interface ErrorStateProps {
  title?: string
  error?: unknown
  onRetry?: () => void
  compact?: boolean
}

export function ErrorState({
  title = 'Something went wrong',
  error,
  onRetry,
  compact,
}: ErrorStateProps) {
  const message =
    error instanceof Error ? error.message : typeof error === 'string' ? error : undefined
  return (
    <div role="alert">
      <EmptyState
        icon="⚠️"
        title={title}
        compact={compact}
        actions={
          onRetry ? (
            <Button size="sm" onClick={onRetry}>
              Try again
            </Button>
          ) : null
        }
      >
        {message ?? 'Dumbledore couldn’t load this. Your data is safe.'}
      </EmptyState>
    </div>
  )
}
