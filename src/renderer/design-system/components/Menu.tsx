/**
 * Menu: Notion's soft dropdown (Radix DropdownMenu). Items take an icon, a shortcut hint,
 * a check mark (for single-choice menus) and a danger tone.
 */
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Check } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/overlays.css'

export interface MenuProps {
  trigger: ReactElement
  children: ReactNode
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

export function Menu({ trigger, children, align = 'start', side = 'bottom', open, onOpenChange, className }: MenuProps) {
  return (
    <Dropdown.Root open={open} onOpenChange={onOpenChange} modal={false}>
      <Dropdown.Trigger asChild>{trigger}</Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content
          className={cx('dd-menu', className)}
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
        >
          {children}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

export interface MenuItemProps {
  children: ReactNode
  onSelect?: () => void
  icon?: ReactNode
  shortcut?: string
  checked?: boolean
  danger?: boolean
  disabled?: boolean
}

export function MenuItem({ children, onSelect, icon, shortcut, checked, danger, disabled }: MenuItemProps) {
  return (
    <Dropdown.Item
      className={cx('dd-menu__item', danger && 'dd-menu__item--danger')}
      onSelect={onSelect}
      disabled={disabled}
    >
      {icon !== undefined ? <span className="dd-menu__icon">{icon}</span> : null}
      <span className="dd-menu__label-text">{children}</span>
      {shortcut ? <span className="dd-menu__shortcut">{shortcut}</span> : null}
      {checked ? (
        <span className="dd-menu__check" aria-label="selected">
          <Check size={14} />
        </span>
      ) : null}
    </Dropdown.Item>
  )
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <Dropdown.Label className="dd-menu__group-label">{children}</Dropdown.Label>
}

export function MenuSeparator() {
  return <Dropdown.Separator className="dd-menu__separator" />
}
