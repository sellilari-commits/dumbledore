/** Kbd: a quiet shortcut hint ("⌘K"), optionally drawn as a keycap. */
import type { ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/controls.css'

export function Kbd({
  children,
  boxed,
  className,
}: {
  children: ReactNode
  boxed?: boolean
  className?: string
}) {
  return <kbd className={cx('dd-kbd', boxed && 'dd-kbd--boxed', className)}>{children}</kbd>
}
