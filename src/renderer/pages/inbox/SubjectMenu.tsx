/**
 * SubjectMenu: Notion's borderless "select" button that opens a menu of subjects. Used to file a
 * loose note to a subject on the Memory page.
 */
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '@renderer/design-system'
import type { SubjectSummary } from '@shared/domain'
import { ChevronDown } from 'lucide-react'
import type { ReactNode } from 'react'

export interface SubjectMenuProps {
  /** Accessible name of the trigger, e.g. "File under subject". */
  label: string
  subjects: SubjectSummary[]
  value: string | null
  onPick: (subjectId: string) => void
  /** Text on the trigger. */
  children: ReactNode
  heading?: string
  /** Extra items after the subjects (e.g. "All subjects", "Unfiled"). */
  extra?: ReactNode
  disabled?: boolean
  align?: 'start' | 'end'
  className?: string
}

export function SubjectMenu({
  label,
  subjects,
  value,
  onPick,
  children,
  heading,
  extra,
  disabled,
  align = 'start',
  className,
}: SubjectMenuProps) {
  return (
    <Menu
      align={align}
      trigger={
        <button
          type="button"
          className={`dd-btn dd-btn--ghost dd-btn--sm ib-select ${className ?? ''}`}
          aria-label={label}
          disabled={disabled}
        >
          <span className="ib-select__text">{children}</span>
          <ChevronDown size={14} strokeWidth={1.75} aria-hidden />
        </button>
      }
    >
      {heading ? <MenuLabel>{heading}</MenuLabel> : null}
      {subjects.map((s) => (
        <MenuItem key={s.id} icon={s.emoji} checked={s.id === value} onSelect={() => onPick(s.id)}>
          {s.name}
          {s.status === 'suggested' ? <span className="ib-select__hint"> · suggested</span> : null}
        </MenuItem>
      ))}
      {subjects.length === 0 ? <MenuItem disabled>No subjects yet</MenuItem> : null}
      {extra ? (
        <>
          <MenuSeparator />
          {extra}
        </>
      ) : null}
    </Menu>
  )
}
