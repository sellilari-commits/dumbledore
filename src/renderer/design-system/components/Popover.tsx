/**
 * Popover: a soft floating card anchored to a trigger (Radix Popover). When the opener lives
 * inside another component (PageHeader's icon via `iconRef`), pass `anchor` instead of
 * `trigger`: the card then positions on that element and gives focus back to it on close.
 */
import * as RadixPopover from '@radix-ui/react-popover'
import { type ReactElement, type ReactNode, type RefObject, useRef } from 'react'
import { cx } from '../cx'
import '../styles/overlays.css'

export interface PopoverProps {
  /** The element that opens the popover. Omit it when `anchor` is set. */
  trigger?: ReactElement
  /**
   * An element rendered elsewhere to anchor to instead of a trigger. Use with controlled
   * `open`: the anchor's own click toggles it (a click on the anchor never counts as outside).
   */
  anchor?: RefObject<HTMLElement | null>
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
  anchor,
  children,
  open,
  onOpenChange,
  align = 'start',
  side = 'bottom',
  className,
  label,
}: PopoverProps) {
  // Closed by clicking or tabbing elsewhere: leave focus there instead of pulling it back.
  const leftOutside = useRef(false)
  const anchored = anchor
    ? {
        onInteractOutside: (e: Event) => {
          if (e.target instanceof Node && anchor.current?.contains(e.target)) e.preventDefault()
          else leftOutside.current = true
        },
        onCloseAutoFocus: (e: Event) => {
          if (!leftOutside.current) {
            e.preventDefault()
            anchor.current?.focus()
          }
          leftOutside.current = false
        },
      }
    : {}
  return (
    <RadixPopover.Root open={open} onOpenChange={onOpenChange}>
      {anchor ? (
        <RadixPopover.Anchor virtualRef={anchor} />
      ) : (
        <RadixPopover.Trigger asChild>{trigger}</RadixPopover.Trigger>
      )}
      <RadixPopover.Portal>
        <RadixPopover.Content
          className={cx('dd-popover', className)}
          align={align}
          side={side}
          sideOffset={4}
          collisionPadding={8}
          aria-label={label}
          {...anchored}
        >
          {children}
        </RadixPopover.Content>
      </RadixPopover.Portal>
    </RadixPopover.Root>
  )
}

export const PopoverClose = RadixPopover.Close
