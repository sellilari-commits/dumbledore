/**
 * Dumbledore's signature: half-moon spectacles, drawn as a monochrome line glyph (◡◡). Two
 * half-moon lenses with a flat top rim, a small arched bridge and short temple arms. Inherits
 * `currentColor`, so each surface tints it with its icon token.
 */
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
      fill="none"
      stroke="currentColor"
      strokeWidth={1.6}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={title ? 'img' : undefined}
      aria-hidden={title ? undefined : true}
      aria-label={title}
    >
      {/* lenses: flat rim on top, half-moon below */}
      <path d="M2.75 11h7.5a3.75 3.75 0 0 1-7.5 0Z" />
      <path d="M13.75 11h7.5a3.75 3.75 0 0 1-7.5 0Z" />
      {/* bridge */}
      <path d="M10.25 11c.55-.9 2.95-.9 3.5 0" />
      {/* temple arms */}
      <path d="M2.75 11 1.5 9.5M21.25 11l1.25-1.5" />
    </svg>
  )
}
