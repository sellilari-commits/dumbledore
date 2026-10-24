/**
 * The frame every onboarding step shares: progress dots ("Step 2 of 5", "All set" on the final
 * screen), a title that takes focus when the step appears, a lead sentence, the step's content
 * and a footer row (Back on the left, secondary and primary actions on the right).
 */
import { type ReactNode, useEffect, useRef } from 'react'
import './onboarding.css'

export const STEP_COUNT = 5

export function Progress({ step }: { step: number }) {
  return (
    <div className="dd-onb__progress">
      <div className="dd-onb__dots" aria-hidden>
        {Array.from({ length: STEP_COUNT }, (_, i) => (
          <span
            // biome-ignore lint/suspicious/noArrayIndexKey: fixed positional dots
            key={i}
            className="dd-onb__dot"
            data-state={i < step ? 'done' : i === step ? 'current' : 'todo'}
          />
        ))}
      </div>
      <span>{step < STEP_COUNT ? `Step ${step + 1} of ${STEP_COUNT}` : 'All set'}</span>
    </div>
  )
}

export interface StepFrameProps {
  step: number
  title: string
  lead?: ReactNode
  /** Shown above the title (welcome mark). */
  art?: ReactNode
  center?: boolean
  children?: ReactNode
  /** Footer: left side (Back) and right side (secondary + primary). */
  back?: ReactNode
  actions?: ReactNode
}

export function StepFrame({
  step,
  title,
  lead,
  art,
  center,
  children,
  back,
  actions,
}: StepFrameProps) {
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    titleRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className={center ? 'dd-onb__column dd-onb__column--center' : 'dd-onb__column'}>
      <Progress step={step} />
      {art}
      <h1 className="dd-onb__title" ref={titleRef} tabIndex={-1}>
        {title}
      </h1>
      {lead ? <p className="dd-onb__lead">{lead}</p> : null}
      {children ? <div className="dd-onb__body">{children}</div> : null}
      {back || actions ? (
        <div className="dd-onb__footer">
          {back}
          <span className="dd-onb__spacer" />
          {actions}
        </div>
      ) : null}
    </div>
  )
}
