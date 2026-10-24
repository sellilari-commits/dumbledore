import { describe, expect, it } from 'vitest'
import { DISPLAY, SECOND_DISPLAY } from '../testing/harness'
import {
  CORNER_SNAP,
  DOCKED_SIZE,
  defaultHome,
  displayAt,
  dockSpot,
  EDGE_INSET,
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

describe('defaultHome', () => {
  it('sits on the right edge of the work area, vertically centred', () => {
    expect(defaultHome(DISPLAY)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: 33 + 949 / 2,
      edge: 'right',
    })
  })
})

describe('snapToEdge', () => {
  it('latches to the nearest side edge and keeps the height', () => {
    expect(snapToEdge(DISPLAY, 40, 500)).toEqual({ displayId: 1, x: LEFT_X, y: 500, edge: 'left' })
    expect(snapToEdge(DISPLAY, 1400, 400)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: 400,
      edge: 'right',
    })
  })

  it('latches to top and bottom when those are nearer', () => {
    expect(snapToEdge(DISPLAY, 700, 60)).toEqual({ displayId: 1, x: 700, y: TOP_Y, edge: 'top' })
    expect(snapToEdge(DISPLAY, 700, 960)).toEqual({
      displayId: 1,
      x: 700,
      y: BOTTOM_Y,
      edge: 'bottom',
    })
  })

  it('goes into a corner when close to two edges', () => {
    const near = CORNER_SNAP - 10
    expect(snapToEdge(DISPLAY, 1512 - near, 33 + near)).toEqual({
      displayId: 1,
      x: RIGHT_X,
      y: TOP_Y,
      edge: 'right',
    })
    expect(snapToEdge(DISPLAY, 5, 980)).toEqual({
      displayId: 1,
      x: LEFT_X,
      y: BOTTOM_Y,
      edge: 'left',
    })
  })

  it('clamps points dropped outside the work area', () => {
    expect(snapToEdge(DISPLAY, -300, 10)).toEqual({
      displayId: 1,
      x: LEFT_X,
      y: TOP_Y,
      edge: 'left',
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
