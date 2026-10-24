/**
 * Tooltip: Notion's small dark label with an optional shortcut and second line. Wrap the app
 * in <TooltipProvider> once; each Tooltip wraps exactly one focusable child.
 */
import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ReactElement, ReactNode } from 'react'
import '../styles/overlays.css'

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <RadixTooltip.Provider delayDuration={400} skipDelayDuration={200}>
      {children}
    </RadixTooltip.Provider>
  )
}

export interface TooltipProps {
  content: ReactNode
  shortcut?: string
  sub?: ReactNode
  side?: 'top' | 'right' | 'bottom' | 'left'
  children: ReactElement
}

export function Tooltip({ content, shortcut, sub, side = 'bottom', children }: TooltipProps) {
  return (
    <RadixTooltip.Root>
      <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          className="dd-tooltip"
          side={side}
          sideOffset={6}
          collisionPadding={8}
        >
          {content}
          {shortcut ? <span className="dd-tooltip__kbd">{shortcut}</span> : null}
          {sub ? <span className="dd-tooltip__sub">{sub}</span> : null}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
