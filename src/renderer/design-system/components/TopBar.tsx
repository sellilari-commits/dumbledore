/**
 * TopBar (44 px, draggable window chrome with no-drag controls) and Breadcrumbs
 * ("Subjects / 🧪 Organic Chemistry"). Crumbs with an href are hash links.
 */
import { Fragment, type ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/layout.css'

export function TopBar({
  left,
  children,
  right,
  className,
  style,
}: {
  left?: ReactNode
  children?: ReactNode
  right?: ReactNode
  className?: string
  style?: React.CSSProperties
}) {
  return (
    <header className={cx('dd-topbar', className)} style={style}>
      {left}
      {children}
      <div className="dd-topbar__spacer" />
      {right}
    </header>
  )
}

export interface Crumb {
  label: ReactNode
  icon?: ReactNode
  href?: string
  muted?: boolean
}

export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav className="dd-crumbs" aria-label="Breadcrumbs">
      {items.map((c, i) => {
        const last = i === items.length - 1
        const body = (
          <>
            {c.icon ? <span aria-hidden>{c.icon}</span> : null}
            <span>{c.label}</span>
          </>
        )
        const key = typeof c.label === 'string' ? c.label : i
        return (
          <Fragment key={key}>
            {i > 0 ? (
              <span className="dd-crumbs__sep" aria-hidden>
                /
              </span>
            ) : null}
            {c.href && !last ? (
              <a className={cx('dd-crumb', c.muted && 'dd-crumb--muted')} href={`#${c.href}`}>
                {body}
              </a>
            ) : (
              <span
                className={cx('dd-crumb', c.muted && 'dd-crumb--muted')}
                aria-current={last ? 'page' : undefined}
              >
                {body}
              </span>
            )}
          </Fragment>
        )
      })}
    </nav>
  )
}
