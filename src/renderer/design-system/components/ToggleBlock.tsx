/** ToggleBlock: Notion's ▸ toggle — a title that expands to show indented content. */
import { ChevronRight } from 'lucide-react'
import { type ReactNode, useId, useState } from 'react'
import { cx } from '../cx'
import '../styles/display.css'

export interface ToggleBlockProps {
  title: ReactNode
  children: ReactNode
  defaultOpen?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
  className?: string
}

export function ToggleBlock({
  title,
  children,
  defaultOpen = false,
  open,
  onOpenChange,
  className,
}: ToggleBlockProps) {
  const [inner, setInner] = useState(defaultOpen)
  const isOpen = open ?? inner
  const id = useId()
  const toggle = () => {
    setInner(!isOpen)
    onOpenChange?.(!isOpen)
  }
  return (
    <div className={cx('dd-toggle', className)} data-open={isOpen}>
      <button
        type="button"
        className="dd-toggle__head"
        aria-expanded={isOpen}
        aria-controls={id}
        onClick={toggle}
      >
        <span className="dd-toggle__chevron" aria-hidden>
          <ChevronRight size={14} strokeWidth={2} />
        </span>
        <span className="dd-toggle__title">{title}</span>
      </button>
      {isOpen ? (
        <div className="dd-toggle__content" id={id}>
          {children}
        </div>
      ) : null}
    </div>
  )
}
