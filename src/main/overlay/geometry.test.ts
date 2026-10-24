import { describe, expect, it } from 'vitest'
import { DISPLAY, SECOND_DISPLAY } from '../testing/harness'
import {
  CORNER_SNAP,
  clearOfReserved,
  DOCKED_SIZE,
  defaultHome,
  displayAt,
  dockSpot,
  EDGE_INSET,
  fitSpot,
  hiddenSpot,
  ORB_SIZE,
  ORB_STACK_EXTENT,
  PEEK,
  RESERVED_CLEARANCE,
  RIGHT_EDGE_RESERVED_HALF,
  snapToEdge,
} from './geometry'

const R = ORB_SIZE / 2
// Work area of DISPLAY in display-local points: y 33…982, x 0…1512.
const LEFT_X = EDGE_INSET + R
const RIGHT_X = 1512 - EDGE_INSET - R
const TOP_Y = 33 + EDGE_INSET + R
const BOTTOM_Y = 982 - EDGE_INSET - R
// Reserved middle of the right edge (Wispr Flow's bar), with the orb's reach around its centre.
const CENTRE = 33 + 949 / 2
const REACH = R + ORB_STACK_EXTENT + RESERVED_CLEARANCE
const ABOVE = CENTRE - RIGHT_EDGE_RESERVED_HALF - REACH
const BELOW = CENTRE + RIGHT_EDGE_RESERVED_HALF + REACH

/** The orb with its timer square overlaps the band (plus clearance) when this is true. */
const overlapsBand = (y: number) =>
  y + R + ORB_STACK_EXTENT + RESERVED_CLEARANCE > CENTRE - RIGHT_EDGE_RESERVED_HALF &&
  y - R - ORB_STACK_EXTENT - RESERVED_CLEARANCE < CENTRE + RIGHT_EDGE_RESERVED_HALF

describe('defaultHome', () => {
  it('sits on the right edge, above the reserved middle (Wispr Flow bar)', () => {
    const home = defaultHome(DISPLAY)
    expect(home).toEqual({ displayId: 1, x: RIGHT_X, y: ABOVE, edge: 'right' })
    expect(overlapsBand(home.y)).toBe(false)
  })
})

describe('reserved band on the right edge', () => {
  it('moves a height inside the band to the nearer side, above on a tie', () => {
    expect(clearOfReserved(DISPLAY, CENTRE)).toBe(ABOVE)
    expect(clearOfReserved(DISPLAY, CENTRE - 10)).toBe(ABOVE)
    expect(clearOfReserved(DISPLAY, CENTRE + 10)).toBe(BELOW)
    expect(clearOfReserved(DISPLAY, ABOVE - 50)).toBe(ABOVE - 50)
    expect(clearOfReserved(DISPLAY, BELOW + 50)).toBe(BELOW + 50)
  })

  it('never overlaps the band and stays on screen, wherever the orb is dropped', () => {
    for (let y = -100; y <= 1100; y += 7) {
      const spot = snapToEdge(DISPLAY, 1000, y)
      expect(overlapsBand(spot.y)).toBe(false)
      expect(spot.y).toBeGreaterThanOrEqual(TOP_Y)
      expect(spot.y).toBeLessThanOrEqual(BOTTOM_Y)
    }
  })

  it('moves an older saved home out of the band when it is re-fitted', () => {
    const old = { displayId: 1, x: RIGHT_X, y: CENTRE, edge: 'right' as const }
    expect(fitSpot(DISPLAY, old).y).toBe(ABOVE)
  })
})

describe('snapToEdge', () => {
  it('always latches to the right edge and keeps the height', () => {
    const drops: [number, number][] = [
      [40, 300],
      [1400, 200],
      [700, 800],
    ]
    for (const [x, y] of drops) {
      expect(snapToEdge(DISPLAY, x, y)).toEqual({ displayId: 1, x: RIGHT_X, y, edge: 'right' })
    }
  })

  it('clamps the height to the work area', () => {
    expect(snapToEdge(DISPLAY, -300, 10)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: TOP_Y,
      edge: 'right',
    })
    expect(snapToEdge(DISPLAY, 700, 2000)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: BOTTOM_Y,
      edge: 'right',
    })
  })
})

describe('dockSpot', () => {
  it('docks just right of the input, vertically centred', () => {
    const input = { x: 400, y: 820, width: 700, height: 56 }
    expect(dockSpot(DISPLAY, input)).toEqual({ x: 400 + 700 + 8 + DOCKED_SIZE / 2, y: 848 })
  })

  it('moves inside the input when there is no room on the right', () => {
    const input = { x: 800, y: 500, width: 700, height: 40 }
    expect(dockSpot(DISPLAY, input)).toEqual({ x: 1500 - 8 - DOCKED_SIZE / 2, y: 520 })
  })

  it('uses display-local coordinates on a second display', () => {
    const input = { x: 1512 + 100, y: 600, width: 500, height: 50 }
    expect(dockSpot(SECOND_DISPLAY, input)).toEqual({ x: 100 + 500 + 8 + DOCKED_SIZE / 2, y: 625 })
  })
})

describe('hiddenSpot', () => {
  it('leaves only a sliver of the orb visible', () => {
    expect(hiddenSpot(DISPLAY, { displayId: 1, x: RIGHT_X, y: 300, edge: 'right' })).toEqual({
      x: 1512 + R - PEEK,
      y: 300,
    })
    expect(hiddenSpot(DISPLAY, { displayId: 1, x: LEFT_X, y: 300, edge: 'left' })).toEqual({
      x: -R + PEEK,
      y: 300,
    })
  })

  it('does not hide into the top edge (menu bar)', () => {
    expect(hiddenSpot(DISPLAY, { displayId: 1, x: 500, y: TOP_Y, edge: 'top' })).toEqual({
      x: 500,
      y: TOP_Y,
    })
  })
})

describe('displayAt', () => {
  it('finds the containing display, else the nearest', () => {
    expect(displayAt([DISPLAY, SECOND_DISPLAY], { x: 2000, y: 500 })?.id).toBe(2)
    expect(displayAt([DISPLAY, SECOND_DISPLAY], { x: 100, y: 100 })?.id).toBe(1)
    expect(displayAt([DISPLAY, SECOND_DISPLAY], { x: 5000, y: 500 })?.id).toBe(2)
    expect(displayAt([], { x: 0, y: 0 })).toBeUndefined()
  })
})
