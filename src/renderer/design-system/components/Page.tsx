/**
 * Page layout: Page (the ~708 px reading column), PageHeader (78 px emoji icon, 40 px title,
 * subtitle, actions), PropertyList/Property (Notion's property rows) and Section (a small grey
 * heading with optional actions, or a large H3 heading).
 */
import type { ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/layout.css'

export function Page({
  children,
  width = 'default',
  className,
}: {
  children: ReactNode
  width?: 'default' | 'wide' | 'full'
  className?: string
}) {
  return (
    <div className={cx('dd-page', width !== 'default' && `dd-page--${width}`, className)}>
      {children}
    </div>
  )
}

export interface PageHeaderProps {
  icon?: ReactNode
  /** Glyph icons (SVG) get icon colour instead of emoji rendering. */
  iconKind?: 'emoji' | 'glyph'
  iconSize?: 'large' | 'small'
  title: ReactNode
  subtitle?: ReactNode
  actions?: ReactNode
  children?: ReactNode
  compact?: boolean
}

export function PageHeader({
  icon,
  iconKind = 'emoji',
  iconSize = 'large',
  title,
  subtitle,
  actions,
  children,
  compact,
}: PageHeaderProps) {
  return (
    <div className={cx('dd-page-header', compact && 'dd-page-header--compact')}>
      {icon ? (
        <div
          className={cx(
            'dd-page-header__icon',
            iconSize === 'small' && 'dd-page-header__icon--small',
            iconKind === 'glyph' && 'dd-page-header__icon--glyph',
          )}
          aria-hidden
        >
          {icon}
        </div>
      ) : null}
      <h1 className="dd-page-header__title">{title}</h1>
      {subtitle ? <div className="dd-page-header__subtitle">{subtitle}</div> : null}
      {children}
      {actions ? <div className="dd-page-header__actions">{actions}</div> : null}
    </div>
  )
}

export function PropertyList({ children, label = 'Properties' }: { children: ReactNode; label?: string }) {
  return (
    <div className="dd-props" role="list" aria-label={label}>
      {children}
    </div>
  )
}

export function Property({
  icon,
  label,
  children,
  empty,
}: {
  icon?: ReactNode
  label: string
  children?: ReactNode
  /** Placeholder shown in tertiary grey when there is no value. */
  empty?: string
}) {
  const hasValue = children !== undefined && children !== null && children !== false
  return (
    <div className="dd-prop" role="listitem">
      <div className="dd-prop__label">
        {icon}
        <span>{label}</span>
      </div>
      <div className={cx('dd-prop__value', !hasValue && 'dd-prop__value--empty')}>
        {hasValue ? children : (empty ?? 'Empty')}
      </div>
    </div>
  )
}

export interface SectionProps {
  title: ReactNode
  icon?: ReactNode
  actions?: ReactNode
  children: ReactNode
  large?: boolean
  plain?: boolean
  className?: string
  id?: string
}

export function Section({ title, icon, actions, children, large, plain, className, id }: SectionProps) {
  return (
    <section className={cx('dd-section', className)} aria-labelledby={id} id={id ? `${id}-section` : undefined}>
      <div className={cx('dd-section__head', (plain || large) && 'dd-section__head--plain')}>
        <h2 className={cx('dd-section__title', large && 'dd-section__title--large')} id={id}>
          {icon}
          {title}
        </h2>
        {actions ? <div className="dd-section__actions">{actions}</div> : null}
      </div>
      {children}
    </section>
  )
}
