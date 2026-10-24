/**
 * Settings building blocks: SettingsSection (16 px heading, hairline, grey description),
 * SettingsRow (label + description left, control right), SelectMenu (Notion's borderless
 * dropdown button) and OkLabel (green "✓ Granted"-style status).
 */
import { Menu, MenuItem } from '@renderer/design-system'
import { Check, ChevronDown } from 'lucide-react'
import { type ReactNode, useId } from 'react'
import './settings.css'

export function SettingsSection({
  title,
  description,
  children,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
}) {
  const id = useId()
  return (
    <section className="dd-set-section" aria-labelledby={id}>
      <div className="dd-set-section__head">
        <h2 className="dd-set-section__title" id={id}>
          {title}
        </h2>
        {description ? <div className="dd-set-section__desc">{description}</div> : null}
      </div>
      {children}
    </section>
  )
}

export interface SettingsRowProps {
  label: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Put the control under the text, full width (lists, text areas). */
  stacked?: boolean
}

export function SettingsRow({ label, description, children, stacked }: SettingsRowProps) {
  return (
    <div className={stacked ? 'dd-set-row dd-set-row--stacked' : 'dd-set-row'}>
      <div className="dd-set-row__text">
        <div className="dd-set-row__label">{label}</div>
        {description ? <div className="dd-set-row__desc">{description}</div> : null}
      </div>
      {children ? (
        <div className={stacked ? undefined : 'dd-set-row__control'}>{children}</div>
      ) : null}
    </div>
  )
}

export interface SelectOption<T extends string | number> {
  value: T
  label: string
}

export interface SelectMenuProps<T extends string | number> {
  /** Accessible name, e.g. "Appearance". */
  label: string
  value: T
  options: ReadonlyArray<SelectOption<T>>
  onChange: (value: T) => void
  disabled?: boolean
}

export function SelectMenu<T extends string | number>({
  label,
  value,
  options,
  onChange,
  disabled,
}: SelectMenuProps<T>) {
  const current = options.find((o) => o.value === value)
  return (
    <Menu
      align="end"
      trigger={
        <button
          type="button"
          className="dd-set-select"
          aria-label={`${label}: ${current?.label ?? 'not set'}`}
          disabled={disabled}
        >
          <span>{current?.label ?? 'Choose…'}</span>
          <ChevronDown size={14} aria-hidden />
        </button>
      }
    >
      {options.map((o) => (
        <MenuItem
          key={String(o.value)}
          checked={o.value === value}
          onSelect={() => onChange(o.value)}
        >
          {o.label}
        </MenuItem>
      ))}
    </Menu>
  )
}

export function OkLabel({ children }: { children: ReactNode }) {
  return (
    <span className="dd-set-ok">
      <Check size={14} strokeWidth={2.5} aria-hidden />
      {children}
    </span>
  )
}
