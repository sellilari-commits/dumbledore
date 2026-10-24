/** The panel window's height: at least the header and a few rows, at most the cap (or the screen). */
import { describe, expect, it } from 'vitest'
import { clampPanelHeight, MAX_HEIGHT, MIN_HEIGHT, panelHeightCap } from './usePanelAutoSize'

describe('panel auto-size', () => {
  it('clamps the measured card between the minimum and the cap', () => {
    expect(clampPanelHeight(0)).toBe(MIN_HEIGHT)
    expect(clampPanelHeight(240.2)).toBe(241)
    expect(clampPanelHeight(5000)).toBe(MAX_HEIGHT)
    expect(clampPanelHeight(5000, 400)).toBe(400)
  })

  it('caps at the screen on a short display', () => {
    expect(panelHeightCap(0)).toBe(MAX_HEIGHT)
    expect(panelHeightCap(1200)).toBe(MAX_HEIGHT)
    expect(panelHeightCap(416)).toBe(400)
    expect(panelHeightCap(100)).toBe(MIN_HEIGHT)
  })
})
