/**
 * Dumbledore's mark ("D2"): half-moon spectacles over a beard. One geometry for every surface — the
 * React glyphs build SVG paths from it, the tray and the app-icon script rasterize it.
 * Coordinates are in a 24×24 box, y down. Angles run clockwise on screen: 0..π is the lower
 * half of a circle, π..2π the upper half.
 */

export type Point = readonly [number, number]

export type StrokeShape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }

/** A closed outline: a start point and the cubic segments that follow it. */
export interface Contour {
  start: Point
  curves: readonly (readonly [Point, Point, Point])[]
}

export const MARK_BOX = 24
/** Spectacles stroke width in box units. */
export const MARK_STROKE = 1.5
/** Below this rendered size the smile is too thin to read and is left out. */
export const SMILE_MIN_SIZE = 32

/** Half-moon lenses (flat rim on top) joined by an arched bridge; no temple arms. */
export const SPECTACLES: readonly StrokeShape[] = [
  { kind: 'line', x1: 4.2, y1: 5.4, x2: 10.4, y2: 5.4 },
  { kind: 'arc', cx: 7.3, cy: 5.4, r: 3.1, a0: 0, a1: Math.PI },
  { kind: 'line', x1: 13.6, y1: 5.4, x2: 19.8, y2: 5.4 },
  { kind: 'arc', cx: 16.7, cy: 5.4, r: 3.1, a0: 0, a1: Math.PI },
  { kind: 'arc', cx: 12, cy: 5.4, r: 1.6, a0: Math.PI, a1: 2 * Math.PI },
]

/** The beard: a moustache dip along the top and a soft, wavy end instead of a point. */
export const BEARD: Contour = {
  start: [4.4, 11],
  curves: [
    [
      [5.9, 12.6],
      [8.2, 13.1],
      [10.1, 12.6],
    ],
    [
      [10.9, 12.4],
      [11.5, 12],
      [12, 11.5],
    ],
    [
      [12.5, 12],
      [13.1, 12.4],
      [13.9, 12.6],
    ],
    [
      [15.8, 13.1],
      [18.1, 12.6],
      [19.6, 11],
    ],
    [
      [19.9, 15.8],
      [17.9, 19],
      [15.3, 20.3],
    ],
    [
      [14.3, 20.8],
      [13.2, 21.4],
      [12, 21.4],
    ],
    [
      [10.8, 21.4],
      [9.7, 20.8],
      [8.7, 20.3],
    ],
    [
      [6.1, 19],
      [4.1, 15.8],
      [4.4, 11],
    ],
  ],
}

/** A small crescent smile cut out of the beard (even-odd), only drawn at larger sizes. */
export const SMILE: Contour = {
  start: [10.3, 15.4],
  curves: [
    [
      [11.4, 16.3],
      [12.6, 16.3],
      [13.7, 15.4],
    ],
    [
      [12.7, 17.2],
      [11.3, 17.2],
      [10.3, 15.4],
    ],
  ],
}

/** The filled contours for a mark drawn at `size` px. */
export function markFills(size: number): Contour[] {
  return size >= SMILE_MIN_SIZE ? [BEARD, SMILE] : [BEARD]
}

const n = (v: number) => Number(v.toFixed(3))

function arcPoint(s: Extract<StrokeShape, { kind: 'arc' }>, a: number): string {
  return `${n(s.cx + s.r * Math.cos(a))} ${n(s.cy + s.r * Math.sin(a))}`
}

/** SVG path data for the stroked spectacles. */
export function spectaclesPath(): string {
  return SPECTACLES.map((s) =>
    s.kind === 'line'
      ? `M${s.x1} ${s.y1}L${s.x2} ${s.y2}`
      : `M${arcPoint(s, s.a0)}A${s.r} ${s.r} 0 0 1 ${arcPoint(s, s.a1)}`,
  ).join('')
}

/** SVG path data for the filled contours; draw with `fill-rule="evenodd"`. */
export function fillPath(contours: readonly Contour[]): string {
  return contours
    .map(
      (c) =>
        `M${c.start.join(' ')}${c.curves.map(([a, b, p]) => `C${a.join(' ')} ${b.join(' ')} ${p.join(' ')}`).join('')}Z`,
    )
    .join('')
}

/** Points along a contour, each cubic split into `steps` straight pieces. */
export function flattenContour(c: Contour, steps = 24): Point[] {
  const out: Point[] = [c.start]
  let p0 = c.start
  for (const [p1, p2, p3] of c.curves) {
    for (let i = 1; i <= steps; i++) {
      const t = i / steps
      const u = 1 - t
      const a = u * u * u
      const b = 3 * u * u * t
      const d = 3 * u * t * t
      const e = t * t * t
      out.push([
        a * p0[0] + b * p1[0] + d * p2[0] + e * p3[0],
        a * p0[1] + b * p1[1] + d * p2[1] + e * p3[1],
      ])
    }
    p0 = p3
  }
  return out
}

/** Standalone SVG of the mark in `currentColor` (for docs, sites and design tools). */
export function markSvg(options: { smile?: boolean; color?: string } = {}): string {
  const fills = options.smile === false ? [BEARD] : [BEARD, SMILE]
  const color = options.color ?? 'currentColor'
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_BOX} ${MARK_BOX}">`,
    '<title>Dumbledore</title>',
    `<path d="${spectaclesPath()}" fill="none" stroke="${color}" stroke-width="${MARK_STROKE}" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${fillPath(fills)}" fill="${color}" fill-rule="evenodd"/>`,
    '</svg>',
  ].join('')
}
