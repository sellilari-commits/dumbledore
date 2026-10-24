/** Popover: a soft floating card anchored to a trigger (Radix Popover). */
import * as RadixPopover from '@radix-ui/react-popover'
import type { ReactElement, ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/overlays.css'

export interface PopoverProps {
  trigger: ReactElement
  children: ReactNode
  open?: boolean
  onOpenChange?: (open: boolean) => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  className?: string
  label?: string
}

export function Popover({
  trigger,
  children,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  className,
  label,
}: PopoverProps) {
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      <RadixPopover.Portal>
        <RadixPopover.Content
          className={cx('dd-popover', className)}
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

export const PopoverClose = RadixPopover.Close
