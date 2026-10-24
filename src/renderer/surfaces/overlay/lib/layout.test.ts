import { describe, expect, it } from 'vitest'
import {
  anchorStyle,
  besideAnchor,
  cardAnchor,
  chipAnchor,
  MARGIN,
  sideToward,
  stackAnchor,
  tooltipAnchor,
  verticalToward,
} from './layout'

const vp = { width: 1280, height: 800 }
const rightOrb = { x: 1248, y: 340, r: 20 }
const leftOrb = { x: 32, y: 340, r: 20 }

describe('direction toward the screen', () => {
  it('follows the latched edge', () => {
    expect(sideToward(rightOrb, 'right', vp)).toBe('left')
    expect(sideToward(leftOrb, 'left', vp)).toBe('right')
    expect(verticalToward(rightOrb, 'bottom', vp)).toBe('up')
    expect(verticalToward(rightOrb, 'top', vp)).toBe('down')
  })

  it('uses the orb position when free', () => {
    expect(sideToward({ x: 900, y: 100, r: 20 }, 'free', vp)).toBe('left')
    expect(sideToward({ x: 300, y: 100, r: 20 }, 'free', vp)).toBe('right')
    expect(verticalToward({ x: 300, y: 700, r: 20 }, 'free', vp)).toBe('up')
    expect(verticalToward({ x: 300, y: 100, r: 20 }, 'right', vp)).toBe('down')
  })
})

describe('side stack', () => {
  it('hangs under the orb, centred on it', () => {
    const a = stackAnchor(rightOrb, 'right', vp)
    expect(a).toMatchObject({ side: 'left', left: 1234, top: 368 })
  })

  it('opens upward near the bottom edge', () => {
    const a = stackAnchor({ x: 1248, y: 760, r: 20 }, 'right', vp)
    expect(a.top).toBeUndefined()
    expect(a.bottom).toBe(800 - (760 - 20 - 8))
  })
})

describe('pill and chip', () => {
  it('puts the pill beside the orb toward the screen, vertically centred', () => {
    expect(besideAnchor(rightOrb, 'left', vp)).toMatchObject({
      right: 1280 - (1248 - 30),
      top: 326,
    })
    expect(besideAnchor(leftOrb, 'right', vp)).toMatchObject({ left: 62, top: 326 })
  })

  it('puts the chip right of a docked orb, truncated to the room there', () => {
    expect(chipAnchor({ x: 900, y: 600, r: 14 }, vp)).toMatchObject({ left: 924, maxWidth: 320 })
    const a = chipAnchor({ x: 1000, y: 600, r: 14 }, vp)
    expect(a.left).toBe(1024)
    expect(a.maxWidth).toBe(1280 - MARGIN - 1024)
  })

  it('moves the chip above the chat box when there is no room beside it', () => {
    const dock = { x: 600, y: 700, width: 600, height: 56 }
    const a = chipAnchor({ x: 1240, y: 728, r: 14 }, vp, dock)
    expect(a.left).toBeUndefined()
    expect(a.right).toBe(1280 - 1254)
    expect(a.bottom).toBe(800 - (700 - 8))
  })
})

describe('cards (toasts, quiz)', () => {
  it('grows out of the orb toward the screen, top-aligned with it', () => {
    const a = cardAnchor(rightOrb, 'right', vp, 320)
    expect(a).toMatchObject({ left: 1248 - 20 - 10 - 320, top: 320, origin: 'right top' })
    expect(a.maxHeight).toBe(800 - 320 - MARGIN)
  })

  it('grows upward when the orb is low on the screen', () => {
    const a = cardAnchor({ x: 1248, y: 700, r: 20 }, 'right', vp, 380)
    expect(a.top).toBeUndefined()
    expect(a).toMatchObject({ bottom: 800 - 720, origin: 'right bottom' })
  })

  it('starts below the Study pill when one is showing', () => {
    expect(cardAnchor(rightOrb, 'right', vp, 320, { clearPill: true }).top).toBe(340 + 14 + 8)
  })

  it('stays on screen', () => {
    const a = cardAnchor({ x: 200, y: 300, r: 20 }, 'free', vp, 380)
    expect(a.left).toBe(230)
    const b = cardAnchor({ x: 250, y: 300, r: 20 }, 'left', { width: 500, height: 800 }, 380)
    expect(b.left).toBe(500 - 380 - MARGIN)
  })

  it('opens above the chat box when docked', () => {
    const dock = { x: 300, y: 600, width: 600, height: 56 }
    const a = cardAnchor({ x: 924, y: 628, r: 14 }, 'right', vp, 320, { dock })
    expect(a).toMatchObject({ left: 938 - 320, bottom: 800 - 590, origin: 'right bottom' })
  })

  it('centres under the orb on the top edge', () => {
    const a = cardAnchor({ x: 640, y: 32, r: 20 }, 'top', vp, 320)
    expect(a).toMatchObject({ left: 480, top: 62, origin: 'center top' })
  })
})

describe('tooltip and styles', () => {
  it('sits above the orb, aligned to its inner side', () => {
    expect(tooltipAnchor(rightOrb, vp)).toMatchObject({ right: 12, top: 340 - 20 - 8 - 26 })
    expect(tooltipAnchor({ x: 32, y: 20, r: 20 }, vp)).toMatchObject({ left: MARGIN, top: 48 })
  })

  it('only emits the properties that are set', () => {
    expect(anchorStyle({ left: 1, top: 2, origin: 'left top' })).toEqual({
      left: 1,
      top: 2,
      transformOrigin: 'left top',
    })
  })
})
