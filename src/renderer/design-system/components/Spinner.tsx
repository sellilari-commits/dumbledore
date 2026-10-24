/** Spinner: a small ring that inherits the text colour. */
import { cx } from '../cx'
import '../styles/display.css'

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <span
      className={cx('dd-spinner', className)}
      style={{ width: size, height: size }}
      role="presentation"
    />
  )
}
