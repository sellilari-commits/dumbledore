/**
 * Sidebar building blocks (Notion's left rail): Sidebar container, SidebarGroup, SidebarItem
 * (link or button, 30 px rows, icon + label + badge/meta + hover-only action) and
 * SidebarSection (small grey heading with an optional hover action).
 */
import type { MouseEvent, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/layout.css'

export function Sidebar({
  collapsed,
  children,
  className,
  label = 'Sidebar',
}: {
  collapsed?: boolean
  children: ReactNode
  className?: string
  label?: string
}) {
  return (
    <aside
      className={cx('dd-sidebar', className)}
      data-collapsed={collapsed ? 'true' : 'false'}
      aria-label={label}
      aria-hidden={collapsed || undefined}
      inert={collapsed || undefined}
    >
      {children}
    </aside>
  )
}

export function SidebarGroup({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('dd-sidebar__group', className)}>{children}</div>
}

export interface SidebarItemProps {
  icon?: ReactNode
  label: ReactNode
  /** Hash route, e.g. "/home" → href "#/home". Renders a button when absent. */
  href?: string
  onClick?: (e: MouseEvent) => void
  active?: boolean
  badge?: number
  meta?: ReactNode
  /** Shown only on hover (e.g. a ⋯ or + button). */
  hoverAction?: ReactNode
  muted?: boolean
  title?: string
}

export function SidebarItem({
  icon,
  label,
  href,
  onClick,
  active,
  badge,
  meta,
  hoverAction,
  muted,
  title,
}: SidebarItemProps) {
  const content = (
    <>
      {icon !== undefined ? <span className="dd-sidebar__icon">{icon}</span> : null}
      <span className="dd-sidebar__label">{label}</span>
      {badge ? (
        <span className="dd-sidebar__badge" aria-label={`${badge} new`}>
          {badge > 99 ? '99+' : badge}
        </span>
      ) : null}
      {meta !== undefined ? <span className="dd-sidebar__meta">{meta}</span> : null}
      {hoverAction ? <span className="dd-sidebar__hover-action">{hoverAction}</span> : null}
    </>
  )
  const className = cx('dd-sidebar__item', muted && 'dd-sidebar__item--muted')
  if (href !== undefined) {
    return (
      <a
        className={className}
        href={`#${href}`}
        aria-current={active ? 'page' : undefined}
        onClick={onClick}
        title={title}
      >
        {content}
      </a>
    )
  }
  return (
    <button
      type="button"
      className={className}
      aria-current={active ? 'page' : undefined}
      onClick={onClick}
      title={title}
    >
      {content}
    </button>
  )
}

export function SidebarSection({
  title,
  action,
  children,
}: {
  title: string
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section aria-label={title}>
      <div className="dd-sidebar__section-head">
        <span>{title}</span>
        {action ? <span className="dd-sidebar__hover-action">{action}</span> : null}
      </div>
      <SidebarGroup>{children}</SidebarGroup>
    </section>
  )
}
