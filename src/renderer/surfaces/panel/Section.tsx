/**
 * Panel building blocks: an inline error line and skeleton lines for loading read models.
 */
import { Skeleton } from '@renderer/design-system'

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
