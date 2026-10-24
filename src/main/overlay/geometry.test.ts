import { describe, expect, it } from 'vitest'
import { DISPLAY, SECOND_DISPLAY } from '../testing/harness'
import {
  DOCKED_SIZE,
  defaultHome,
  displayAt,
  dockSpot,
  EDGE_INSET,
  fitSpot,
  hiddenSpot,
  ORB_SIZE,
  PEEK,
  snapToEdge,
} from './geometry'

const R = ORB_SIZE / 2
// Work area of DISPLAY in display-local points: y 33…982, x 0…1512.
const LEFT_X = EDGE_INSET + R
const RIGHT_X = 1512 - EDGE_INSET - R
const TOP_Y = 33 + EDGE_INSET + R
const BOTTOM_Y = 982 - EDGE_INSET - R
const CENTRE = 33 + 949 / 2

describe('defaultHome', () => {
  it('sits on the right edge, a third of the way down, on a first run', () => {
    expect(defaultHome(DISPLAY)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: 33 + 949 / 3,
      edge: 'right',
    })
  })
})

describe('placement anywhere on the edge', () => {
  it('keeps a drop in the middle of the right edge exactly there', () => {
    expect(snapToEdge(DISPLAY, 1000, CENTRE)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: CENTRE,
      edge: 'right',
    })
  })

  it('keeps a saved home in the middle when it is re-fitted', () => {
    const saved = { displayId: 1, x: RIGHT_X, y: CENTRE, edge: 'right' as const }
    expect(fitSpot(DISPLAY, saved)).toEqual(saved)
  })

  it('stays on screen wherever the orb is dropped', () => {
    for (let y = -100; y <= 1100; y += 7) {
      const spot = snapToEdge(DISPLAY, 1000, y)
      expect(spot.y).toBeGreaterThanOrEqual(TOP_Y)
      expect(spot.y).toBeLessThanOrEqual(BOTTOM_Y)
    }
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
