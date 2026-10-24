/** Switch: Notion's small blue toggle, built on Radix Switch for keyboard + a11y. */
import * as RadixSwitch from '@radix-ui/react-switch'
import { cx } from '../cx'
import '../styles/controls.css'

export interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  label: string
  disabled?: boolean
  className?: string
  id?: string
}

export function Switch({ checked, onCheckedChange, label, disabled, className, id }: SwitchProps) {
  return (
    <RadixSwitch.Root
      id={id}
      className={cx('dd-switch', className)}
      checked={checked}
      onCheckedChange={onCheckedChange}
      disabled={disabled}
      aria-label={label}
    >
      <RadixSwitch.Thumb className="dd-switch__thumb" />
    </RadixSwitch.Root>
  )
}
