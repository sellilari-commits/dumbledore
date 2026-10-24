/**
 * Dialog: a centred card on a soft scrim (Radix Dialog: focus trap, Esc closes). Title,
 * optional description, body and a right-aligned footer for actions.
 */
import * as RadixDialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cx } from '../cx'
import '../styles/overlays.css'
import { IconButton } from './Button'

export interface DialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: ReactNode
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
}

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  wide,
  className,
}: DialogProps) {
  return (
    <RadixDialog.Root open={open} onOpenChange={onOpenChange}>
      <RadixDialog.Portal>
        <RadixDialog.Overlay className="dd-dialog__overlay" />
        <RadixDialog.Content className={cx('dd-dialog', wide && 'dd-dialog--wide', className)}>
          <div className="dd-dialog__header">
            <div className="dd-dialog__titles">
              <RadixDialog.Title className="dd-dialog__title">{title}</RadixDialog.Title>
              {description ? (
                <RadixDialog.Description className="dd-dialog__description">
                  {description}
                </RadixDialog.Description>
              ) : (
                <RadixDialog.Description className="dd-sr-only">{title}</RadixDialog.Description>
              )}
            </div>
            <RadixDialog.Close asChild>
              <IconButton label="Close" size="sm">
                <X size={16} />
              </IconButton>
            </RadixDialog.Close>
          </div>
          <div className="dd-dialog__body">{children}</div>
          {footer ? <div className="dd-dialog__footer">{footer}</div> : null}
        </RadixDialog.Content>
      </RadixDialog.Portal>
    </RadixDialog.Root>
  )
}
