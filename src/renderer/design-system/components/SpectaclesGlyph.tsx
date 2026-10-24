/**
 * SpectaclesGlyph: Dumbledore's mark — half-moon spectacles over a beard (`@shared/brand-mark`).
 * Monochrome; inherits the text colour. The smile cut into the beard shows from 32 px up.
 */
import { fillPath, MARK_STROKE, markFills, spectaclesPath } from '@shared/brand-mark'
import { cx } from '../cx'
import '../styles/display.css'

const SPECTACLES_D = spectaclesPath()

export interface SpectaclesGlyphProps {
  size?: number
  strokeWidth?: number
  className?: string
  /** Accessible name; omit for a decorative glyph. */
  title?: string
}

export function SpectaclesGlyph({
  size = 20,
  strokeWidth = MARK_STROKE,
  className,
  title,
}: SpectaclesGlyphProps) {
  return (
    <svg
      className={cx('dd-glyph', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* spectacles: flat-topped half-moon lenses, bridge, temples */}
      <path
        d={SPECTACLES_D}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* beard, with the smile cut out at larger sizes */}
      <path d={fillPath(markFills(size))} fill="currentColor" fillRule="evenodd" />
    </svg>
  )
}
