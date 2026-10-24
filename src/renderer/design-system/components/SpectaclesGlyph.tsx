/**
 * SpectaclesGlyph: Dumbledore's half-moon spectacles — two flat-topped half-circle lenses, a
 * small arched bridge and short temples. Monochrome; inherits the text colour.
 */
import { cx } from '../cx'
import '../styles/display.css'

export interface SpectaclesGlyphProps {
  size?: number
  strokeWidth?: number
  className?: string
  /** Accessible name; omit for a decorative glyph. */
  title?: string
}

export function SpectaclesGlyph({ size = 20, strokeWidth = 1.6, className, title }: SpectaclesGlyphProps) {
  return (
    <svg
      className={cx('dd-glyph', className)}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* lenses: flat top, round bottom */}
      <path d="M2.75 10.25h7.5a3.75 3.75 0 0 1-7.5 0Z" />
      <path d="M13.75 10.25h7.5a3.75 3.75 0 0 1-7.5 0Z" />
      {/* bridge */}
      <path d="M10.25 10.75c1-1.1 2.5-1.1 3.5 0" />
      {/* temples */}
      <path d="M2.75 10.25 1.25 8.5" />
      <path d="M21.25 10.25 22.75 8.5" />
    </svg>
  )
}
