/** Callout: Notion's tinted block with an emoji, a bold title line and free content. */
import type { NotionColor } from '@shared/domain'
import type { ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/display.css'

export interface CalloutProps {
  icon?: ReactNode
  title?: ReactNode
  color?: NotionColor
  children?: ReactNode
  className?: string
  role?: 'note' | 'alert' | 'status'
}

export function Callout({ icon = '💡', title, color = 'default', children, className, role }: CalloutProps) {
  return (
    <div
      className={cx(
        'dd-callout',
        color !== 'default' && `dd-callout--tinted dd-callout--${color}`,
        className,
      )}
      role={role}
    >
      <div className="dd-callout__icon" aria-hidden>
        {icon}
      </div>
      <div className="dd-callout__body">
        {title ? <div className="dd-callout__title">{title}</div> : null}
        {children}
      </div>
    </div>
  )
}
