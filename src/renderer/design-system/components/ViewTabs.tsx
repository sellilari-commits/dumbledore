/**
 * ViewTabs: Notion's database view tabs (icon + label, underline on the active one).
 * Controlled; ←/→ move between tabs. The page renders the active view itself.
 */
import { type KeyboardEvent, type ReactNode, useRef } from 'react'
import { cx } from '../cx'
import '../styles/layout.css'

export interface ViewTab<T extends string> {
  value: T
  label: string
  icon?: ReactNode
  count?: number
}

export interface ViewTabsProps<T extends string> {
  tabs: ReadonlyArray<ViewTab<T>>
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
  right?: ReactNode
}

export function ViewTabs<T extends string>({
  tabs,
  value,
  onChange,
  label = 'Views',
  className,
  right,
}: ViewTabsProps<T>) {
  const ref = useRef<HTMLDivElement>(null)
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return
    const i = tabs.findIndex((t) => t.value === value)
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length]
    if (!next) return
    e.preventDefault()
    onChange(next.value)
    ref.current?.querySelector<HTMLButtonElement>(`[data-value="${next.value}"]`)?.focus()
  }
  return (
    <div className={cx('dd-tabs', className)}>
      <div
        ref={ref}
        role="tablist"
        aria-label={label}
        style={{ display: 'flex' }}
        onKeyDown={onKeyDown}
      >
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            role="tab"
            data-value={t.value}
            aria-selected={t.value === value}
            tabIndex={t.value === value ? 0 : -1}
            className="dd-tab"
            onClick={() => onChange(t.value)}
          >
            <span className="dd-tab__inner">
              {t.icon}
              {t.label}
              {t.count !== undefined ? <span className="dd-tab__count">{t.count}</span> : null}
            </span>
          </button>
        ))}
      </div>
      {right ? (
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center' }}>{right}</div>
      ) : null}
    </div>
  )
}
