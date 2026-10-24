/**
 * Dumbledore's mark: half-moon spectacles over a beard. One geometry for every surface — the
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
export const MARK_STROKE = 1.8
/** Below this rendered size the smile is too thin to read and is left out. */
export const SMILE_MIN_SIZE = 32

/** Half-moon lenses (flat rim on top), an arched bridge and short temple arms. */
export const SPECTACLES: readonly StrokeShape[] = [
  { kind: 'line', x1: 3.5, y1: 6, x2: 10.5, y2: 6 },
  { kind: 'arc', cx: 7, cy: 6, r: 3.5, a0: 0, a1: Math.PI },
  { kind: 'line', x1: 13.5, y1: 6, x2: 20.5, y2: 6 },
  { kind: 'arc', cx: 17, cy: 6, r: 3.5, a0: 0, a1: Math.PI },
  { kind: 'arc', cx: 12, cy: 6, r: 1.5, a0: Math.PI, a1: 2 * Math.PI },
  { kind: 'line', x1: 3.5, y1: 6, x2: 2.1, y2: 4.4 },
  { kind: 'line', x1: 20.5, y1: 6, x2: 21.9, y2: 4.4 },
]

/** The beard: pointed at the bottom, with a moustache dip along the top edge. */
export const BEARD: Contour = {
  start: [3.6, 11.2],
  curves: [
    [
      [3.6, 17.4],
      [7.4, 21.3],
      [12, 23],
    ],
    [
      [16.6, 21.3],
      [20.4, 17.4],
      [20.4, 11.2],
    ],
    [
      [18.9, 12.9],
      [16.4, 13.7],
      [14.3, 13.3],
    ],
    [
      [13.4, 13.1],
      [12.6, 12.7],
      [12, 12.2],
    ],
    [
      [11.4, 12.7],
      [10.6, 13.1],
      [9.7, 13.3],
    ],
    [
      [7.6, 13.7],
      [5.1, 12.9],
      [3.6, 11.2],
    ],
  ],
}

/** A thin crescent cut out of the beard (even-odd), only drawn at larger sizes. */
export const SMILE: Contour = {
  start: [9.9, 16.1],
  curves: [
    [
      [11.3, 17.17],
      [12.7, 17.17],
      [14.1, 16.1],
    ],
    [
      [12.7, 18.17],
      [11.3, 18.17],
      [9.9, 16.1],
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
