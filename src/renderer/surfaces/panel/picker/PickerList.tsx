/**
 * The picker's listbox: "Learn “…”" for typed text, subjects (emoji, name, Resume / due tags)
 * and their study questions. The input owns the keyboard (combobox pattern); rows follow the
 * pointer and the active one scrolls into view.
 */
import { cx, Spinner, Tag } from '@renderer/design-system'
import { CornerDownLeft, CornerDownRight } from 'lucide-react'
import { useEffect, useRef } from 'react'
import type { PickerOption } from './picker-options'

export const optionDomId = (listId: string, option: PickerOption) => `${listId}-${option.id}`

interface Props {
  id: string
  options: PickerOption[]
  active: number
  /** Option being started right now (spinner), if any. */
  chosen: string | null
  onHover: (index: number) => void
  onChoose: (option: PickerOption) => void
}

function Content({ option }: { option: PickerOption }) {
  switch (option.kind) {
    case 'custom':
      return (
        <>
          <span className="pn-opt__icon" aria-hidden>
            ✨
          </span>
          <span className="pn-opt__label">
            Learn <strong>“{option.text}”</strong>
          </span>
          <span className="pn-opt__meta">New roadmap</span>
        </>
      )
    case 'subject':
      return (
        <>
          <span className="pn-opt__icon" aria-hidden>
            {option.subject.emoji}
          </span>
          <span className="pn-opt__label">{option.subject.name}</span>
          {option.resume ? <Tag color="blue">Resume</Tag> : null}
          {option.subject.dueReviews > 0 ? (
            <Tag color="orange">{option.subject.dueReviews} due</Tag>
          ) : null}
        </>
      )
    case 'question':
      return (
        <>
          <span className="pn-opt__icon pn-opt__icon--q" aria-hidden>
            <CornerDownRight size={13} strokeWidth={1.75} />
          </span>
          <span className="pn-opt__label">{option.question}</span>
        </>
      )
  }
}

export function PickerList({ id, options, active, chosen, onHover, onChoose }: Props) {
  const list = useRef<HTMLDivElement>(null)
  const activeId = options[active] ? optionDomId(id, options[active]) : null

  useEffect(() => {
    if (!activeId) return
    const el = list.current?.ownerDocument.getElementById(activeId)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeId])

  return (
    <div ref={list} id={id} role="listbox" aria-label="What to study" className="pn-options">
      {options.map((option, i) => {
        const isActive = i === active
        return (
          // biome-ignore lint/a11y/useKeyWithClickEvents: the combobox input handles the keys
          <div
            key={option.id}
            id={optionDomId(id, option)}
            role="option"
            tabIndex={-1}
            aria-selected={isActive}
            className={cx('pn-opt', `pn-opt--${option.kind}`, isActive && 'is-active')}
            onMouseMove={() => {
              if (!isActive) onHover(i)
            }}
            onClick={() => onChoose(option)}
          >
            <Content option={option} />
            <span className="pn-opt__enter" aria-hidden>
              {chosen === option.id ? (
                <Spinner size={12} />
              ) : isActive ? (
                <CornerDownLeft size={13} strokeWidth={2} />
              ) : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}
