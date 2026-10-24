/**
 * Dumbledore's signature: half-moon spectacles over a beard, drawn from `@shared/brand-mark`.
 * Inherits `currentColor`, so each surface tints it with its icon token. The smile cut into
 * the beard only shows from 32 px up; the orb's glyph is smaller and goes without.
 */
import { fillPath, MARK_STROKE, markFills, spectaclesPath } from '@shared/brand-mark'

const SPECTACLES_D = spectaclesPath()

interface Props {
  size?: number
  className?: string
  title?: string
}

export function SpectaclesGlyph({ size = 22, className, title }: Props) {
  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* spectacles: flat rim on top, half-moon below, bridge and temple arms */}
      <path
        d={SPECTACLES_D}
        fill="none"
        stroke="currentColor"
        strokeWidth={MARK_STROKE}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* beard */}
      <path d={fillPath(markFills(size))} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
