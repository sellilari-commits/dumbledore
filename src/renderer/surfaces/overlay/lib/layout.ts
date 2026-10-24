/**
 * Placement math for everything that hangs off the orb (side stack, pill, chip, toasts, quiz
 * card, tooltip). Pure functions over the orb's centre, its edge and the window size, so every
 * case is unit-tested. Positions are CSS anchors: one of left/right plus one of top/bottom, which
 * lets satellites grow toward the screen without measuring them first.
 */
import type { Rect } from '@shared/geometry'
import type { OverlayState } from '@shared/state'

export type Edge = OverlayState['edge']
export type Side = 'left' | 'right'
export type Vertical = 'down' | 'up'

export interface Size {
  width: number
  height: number
}

/** The orb's centre and radius in window coordinates. */
export interface OrbBox {
  x: number
  y: number
  r: number
}

export interface Anchor {
  left?: number
  right?: number
  top?: number
  bottom?: number
  /** Space left toward the far screen edge, for cards that may need to scroll. */
  maxHeight?: number
  /** Room left beside the orb, for rows that truncate (the chip). */
  maxWidth?: number
  /** transform-origin pointing back at the orb, for grow/collapse animations. */
  origin: string
}

/** Satellites keep this far from the screen edges. */
export const MARGIN = 12
/** Space between the orb and a satellite beside it. */
export const GAP = 10
/** Height of the pill, the chip and the side-stack squares. */
export const ROW = 28
/** Widest the suggestion chip gets (its text is truncated). */
export const CHIP_MAX = 320
/** Narrowest room beside the docked orb that still fits a readable chip. */
export const CHIP_MIN = 180

const clamp = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), Math.max(lo, hi))

/** Horizontal direction from the orb toward the screen. */
export function sideToward(orb: OrbBox, edge: Edge, vp: Size): Side {
  if (edge === 'right') return 'left'
  if (edge === 'left') return 'right'
  return orb.x > vp.width / 2 ? 'left' : 'right'
}

/** Vertical direction from the orb toward the screen. */
export function verticalToward(orb: OrbBox, edge: Edge, vp: Size): Vertical {
  if (edge === 'bottom') return 'up'
  if (edge === 'top') return 'down'
  return orb.y > vp.height * 0.55 ? 'up' : 'down'
}

/** Side stack: a column of 28 pt squares under the orb (above it near the bottom edge). */
export function stackAnchor(orb: OrbBox, edge: Edge, vp: Size): Anchor & { side: Side } {
  const side = sideToward(orb, edge, vp)
  const left = orb.x - ROW / 2
  if (verticalToward(orb, edge, vp) === 'down') {
    return { side, left, top: orb.y + orb.r + 8, origin: 'center top' }
  }
  return { side, left, bottom: vp.height - (orb.y - orb.r - 8), origin: 'center bottom' }
}

/** Pill or tooltip-sized row beside the orb, vertically centred on it. */
export function besideAnchor(orb: OrbBox, side: Side, vp: Size): Anchor {
  const top = orb.y - ROW / 2
  if (side === 'left')
    return { right: vp.width - (orb.x - orb.r - GAP), top, origin: 'right center' }
  return { left: orb.x + orb.r + GAP, top, origin: 'left center' }
}

/**
 * Suggestion chip: right of the docked orb, truncated to the room there; when that is too
 * tight, just above the chat box (or the orb), right-aligned with the orb.
 */
export function chipAnchor(orb: OrbBox, vp: Size, dock: Rect | null = null): Anchor {
  const room = vp.width - MARGIN - (orb.x + orb.r + GAP)
  if (room >= CHIP_MIN) {
    return { ...besideAnchor(orb, 'right', vp), maxWidth: Math.min(CHIP_MAX, room) }
  }
  const top = Math.min(dock?.y ?? Number.POSITIVE_INFINITY, orb.y - orb.r)
  return {
    right: Math.max(MARGIN, vp.width - (orb.x + orb.r)),
    bottom: vp.height - (top - 8),
    maxWidth: CHIP_MAX,
    origin: 'right bottom',
  }
}

export interface CardOptions {
  /** A pill sits beside the orb; start the card below (or above) it. */
  clearPill?: boolean
  /** The chat box the orb is docked to; cards then open above it (or below it). */
  dock?: Rect | null
}

/** Toast or quiz card of a known width, growing out of the orb toward the screen. */
export function cardAnchor(
  orb: OrbBox,
  edge: Edge,
  vp: Size,
  width: number,
  opts: CardOptions = {},
): Anchor {
  const maxLeft = vp.width - width - MARGIN

  if (opts.dock) {
    const left = clamp(orb.x + orb.r - width, MARGIN, maxLeft)
    const roomAbove = opts.dock.y - GAP - MARGIN
    const roomBelow = vp.height - (opts.dock.y + opts.dock.height + GAP) - MARGIN
    if (roomAbove >= Math.min(260, roomBelow)) {
      return {
        left,
        bottom: vp.height - (opts.dock.y - GAP),
        maxHeight: roomAbove,
        origin: 'right bottom',
      }
    }
    return {
      left,
      top: opts.dock.y + opts.dock.height + GAP,
      maxHeight: roomBelow,
      origin: 'right top',
    }
  }

  if (edge === 'top' || edge === 'bottom') {
    const left = clamp(orb.x - width / 2, MARGIN, maxLeft)
    if (edge === 'top') {
      const top = orb.y + orb.r + GAP
      return { left, top, maxHeight: vp.height - top - MARGIN, origin: 'center top' }
    }
    const bottom = vp.height - (orb.y - orb.r - GAP)
    return { left, bottom, maxHeight: vp.height - bottom - MARGIN, origin: 'center bottom' }
  }

  const side = sideToward(orb, edge, vp)
  const rawLeft = side === 'left' ? orb.x - orb.r - GAP - width : orb.x + orb.r + GAP
  const left = clamp(rawLeft, MARGIN, maxLeft)
  const h = side === 'left' ? 'right' : 'left'
  const pillHalf = opts.clearPill ? ROW / 2 + 8 : -orb.r

  if (verticalToward(orb, edge, vp) === 'down') {
    const top = Math.max(MARGIN, orb.y + pillHalf)
    return { left, top, maxHeight: vp.height - top - MARGIN, origin: `${h} top` }
  }
  const bottom = Math.max(MARGIN, vp.height - (orb.y - pillHalf))
  return { left, bottom, maxHeight: vp.height - bottom - MARGIN, origin: `${h} bottom` }
}

/** Hover tooltip: above the orb (below it near the top edge), aligned to the inner side. */
export function tooltipAnchor(orb: OrbBox, vp: Size): Anchor {
  const height = 26
  const aboveTop = orb.y - orb.r - 8 - height
  const horizontal: Pick<Anchor, 'left' | 'right'> =
    orb.x > vp.width / 2
      ? { right: Math.max(MARGIN, vp.width - (orb.x + orb.r)) }
      : { left: Math.max(MARGIN, orb.x - orb.r) }
  if (aboveTop >= MARGIN) return { ...horizontal, top: aboveTop, origin: 'center bottom' }
  return { ...horizontal, top: orb.y + orb.r + 8, origin: 'center top' }
}

/** Inline style for an anchor (only the properties that are set). */
export function anchorStyle(a: Anchor): Record<string, string | number> {
  const style: Record<string, string | number> = { transformOrigin: a.origin }
  if (a.left !== undefined) style.left = a.left
  if (a.right !== undefined) style.right = a.right
  if (a.top !== undefined) style.top = a.top
  if (a.bottom !== undefined) style.bottom = a.bottom
  if (a.maxHeight !== undefined) style.maxHeight = Math.max(120, a.maxHeight)
  if (a.maxWidth !== undefined) style.maxWidth = a.maxWidth
  return style
}
