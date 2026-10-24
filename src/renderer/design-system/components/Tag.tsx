/** Tag: Notion's select tag in one of the nine colours (or default grey). Colour = meaning. */
import type { NotionColor } from '@shared/domain'
import type { ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/display.css'

export interface TagProps {
  color?: NotionColor
  children: ReactNode
  /** Small dot before the label (status tags). */
  dot?: boolean
  className?: string
  title?: string
}

export function Tag({ color = 'default', children, dot, className, title }: TagProps) {
  return (
    <span className={cx('dd-tag', `dd-tag--${color}`, className)} title={title}>
      {dot ? <span className="dd-tag__dot" aria-hidden /> : null}
      {children}
    </span>
  )
}
