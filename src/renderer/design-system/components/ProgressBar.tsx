/** ProgressBar: thin 4 px bar, green fill by default, optional percentage label. */
import { cx } from '../cx'
import '../styles/display.css'

export interface ProgressBarProps {
  value: number // 0..1
  label?: string
  showValue?: boolean
  color?: 'green' | 'blue' | 'red' | 'yellow' | 'orange' | 'gray'
  className?: string
  width?: number | string
}

export function ProgressBar({
  value,
  label,
  showValue,
  color = 'green',
  className,
  width,
}: ProgressBarProps) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div
      className={cx('dd-progress', color !== 'green' && `dd-progress--${color}`, className)}
      style={width === undefined ? undefined : { width }}
    >
      <div
        className="dd-progress__track"
        role="progressbar"
        aria-label={label ?? 'Progress'}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
      >
        <div className="dd-progress__fill" style={{ width: `${pct}%` }} />
      </div>
      {showValue ? <span className="dd-progress__label">{pct}%</span> : null}
    </div>
  )
}
