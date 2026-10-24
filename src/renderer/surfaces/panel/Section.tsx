/**
 * Panel building blocks: Section (a quiet Notion label with an optional aside), a muted Note,
 * an inline error line and skeleton lines for loading read models.
 */
import { cx, Skeleton } from '@renderer/design-system'
import { type ReactNode, useId } from 'react'

export function Section({
  title,
  aside,
  children,
  className,
}: {
  title: ReactNode
  aside?: ReactNode
  children: ReactNode
  className?: string
}) {
  const id = useId()
  return (
    <section className={cx('pn-section', className)} aria-labelledby={id}>
      <div className="pn-section__head">
        <h2 id={id} className="pn-section__title">
          {title}
        </h2>
        {aside ? <div className="pn-section__aside">{aside}</div> : null}
      </div>
      {children}
    </section>
  )
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="pn-note">{children}</p>
}

export function SectionError({ error }: { error: unknown }) {
  const text = error instanceof Error ? error.message : 'Couldn’t load this.'
  return (
    <p className="pn-note pn-note--error" role="alert">
      {text}
    </p>
  )
}

const WIDTHS = ['86%', '64%', '74%']

export function SectionLoading({ lines = 2, label }: { lines?: number; label: string }) {
  return (
    <div className="pn-skel" role="status">
      <span className="dd-sr-only">{label}</span>
      {WIDTHS.slice(0, lines).map((w) => (
        <Skeleton key={w} width={w} height={12} />
      ))}
    </div>
  )
}
