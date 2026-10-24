/**
 * Orb geometry, pure maths: default home, latch/snap to edges and corners, docking beside a chat
 * input, hiding into an edge, and display lookup.
 *
 * Inputs are global screen points (top-left origin, y down — Electron `screen` and the helper use
 * the same convention). Orb positions are the orb's centre in display-local points, which equal
 * overlay-window coordinates because each overlay covers its display exactly.
 */
import type { Point, Rect } from '@shared/geometry'

export interface DisplayInfo {
  id: number
  /** Whole display, global points. */
  bounds: Rect
  /** Display minus menu bar and Dock, global points. */
  workArea: Rect
  primary: boolean
}

export type Edge = 'left' | 'right' | 'top' | 'bottom' | 'free'

/** Where the orb sits: centre in display-local points plus the edge it is latched to. */
export interface OrbSpot {
  displayId: number
  x: number
  y: number
  edge: Edge
}

export const ORB_SIZE = 40
export const DOCKED_SIZE = 28
/** Gap between the orb and the screen edge it is latched to. */
export const EDGE_INSET = 10
/** Within this distance of two edges at once, the orb latches into the corner. */
export const CORNER_SNAP = 96
/** Gap between a chat input and the docked orb. */
export const DOCK_GAP = 8
/** How much of the orb stays visible when hidden into an edge. */
export const PEEK = 8

const clamp = (v: number, lo: number, hi: number) => (hi < lo ? lo : Math.min(hi, Math.max(lo, v)))

export function toLocalRect(d: DisplayInfo, r: Rect): Rect {
  return { x: r.x - d.bounds.x, y: r.y - d.bounds.y, width: r.width, height: r.height }
}

export function toLocalPoint(d: DisplayInfo, p: Point): Point {
  return { x: p.x - d.bounds.x, y: p.y - d.bounds.y }
}

export function toGlobalPoint(d: DisplayInfo, p: Point): Point {
  return { x: p.x + d.bounds.x, y: p.y + d.bounds.y }
}

export function localWorkArea(d: DisplayInfo): Rect {
  return toLocalRect(d, d.workArea)
}

/** The display containing `p` (global), else the nearest one; undefined when there is none. */
export function displayAt(displays: DisplayInfo[], p: Point): DisplayInfo | undefined {
  const inside = displays.find(
    (d) =>
      p.x >= d.bounds.x &&
      p.x < d.bounds.x + d.bounds.width &&
      p.y >= d.bounds.y &&
      p.y < d.bounds.y + d.bounds.height,
  )
  if (inside) return inside
  let best: DisplayInfo | undefined
  let bestDist = Number.POSITIVE_INFINITY
  for (const d of displays) {
    const dx = clamp(p.x, d.bounds.x, d.bounds.x + d.bounds.width) - p.x
    const dy = clamp(p.y, d.bounds.y, d.bounds.y + d.bounds.height) - p.y
    const dist = dx * dx + dy * dy
    if (dist < bestDist) {
      bestDist = dist
      best = d
    }
  }
  return best
}

export function primaryDisplay(displays: DisplayInfo[]): DisplayInfo | undefined {
  return displays.find((d) => d.primary) ?? displays[0]
}

/** Default home: right edge of the work area, vertically centred (the notch is Goldfish's). */
export function defaultHome(d: DisplayInfo, size = ORB_SIZE): OrbSpot {
  const wa = localWorkArea(d)
  return {
    displayId: d.id,
    x: wa.x + wa.width - EDGE_INSET - size / 2,
    y: wa.y + wa.height / 2,
    edge: 'right',
  }
}

/**
 * Latches a dropped orb to the right edge (Ilari, 2026-10-24: the orb always lives on the right
 * side of the screen). A drag only moves it up and down; x is ignored.
 */
export function snapToEdge(d: DisplayInfo, _x: number, y: number, size = ORB_SIZE): OrbSpot {
  const wa = localWorkArea(d)
  const r = size / 2
  const rightX = wa.x + wa.width - EDGE_INSET - r
  const topY = wa.y + EDGE_INSET + r
  const bottomY = wa.y + wa.height - EDGE_INSET - r
  return { displayId: d.id, x: rightX, y: clamp(y, topY, bottomY), edge: 'right' }
}

/** Re-latches a saved spot so it stays on screen after the display changed size. */
export function fitSpot(d: DisplayInfo, spot: OrbSpot): OrbSpot {
  return snapToEdge(d, spot.x, spot.y)
}

/**
 * Where the docked orb goes beside a focused chat input (`target` in global points): just right
 * of the input, or inside its right end when there is no room on screen.
 */
export function dockSpot(d: DisplayInfo, target: Rect, size = DOCKED_SIZE): Point {
  const t = toLocalRect(d, target)
  const wa = localWorkArea(d)
  const r = size / 2
  let x = t.x + t.width + DOCK_GAP + r
  if (x + r > wa.x + wa.width - 2) x = t.x + t.width - DOCK_GAP - r
  const y = clamp(t.y + t.height / 2, wa.y + r, wa.y + wa.height - r)
  return { x, y }
}

/** Position of an orb hidden into its edge (only left/right/bottom edges hide). */
export function hiddenSpot(d: DisplayInfo, spot: OrbSpot, size = ORB_SIZE): Point {
  const wa = localWorkArea(d)
  const r = size / 2
  switch (spot.edge) {
    case 'right':
      return { x: wa.x + wa.width + r - PEEK, y: spot.y }
    case 'left':
      return { x: wa.x - r + PEEK, y: spot.y }
    case 'bottom':
      return { x: spot.x, y: wa.y + wa.height + r - PEEK }
    default:
      return { x: spot.x, y: spot.y }
  }
}

export function canHideIntoEdge(edge: Edge): boolean {
  return edge === 'left' || edge === 'right' || edge === 'bottom'
}
