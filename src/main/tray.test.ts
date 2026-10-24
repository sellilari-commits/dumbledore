import { inflateSync } from 'node:zlib'
import { describe, expect, it, vi } from 'vitest'
import { menuTemplate, type TrayActions } from './tray'
import { crc32, encodePng, rasterizeGlyph, trayIconPngs } from './tray-icon'

vi.mock('electron', () => ({ Menu: {}, nativeImage: {}, Tray: class {} }))

/** Reads width, height and the raw scanlines back out of one of our PNGs. */
function decodePng(png: Buffer): { width: number; height: number; rgba: Uint8Array } {
  expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  let offset = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (offset < png.length) {
    const length = png.readUInt32BE(offset)
    const type = png.toString('ascii', offset + 4, offset + 8)
    const data = png.subarray(offset + 8, offset + 8 + length)
    const crc = png.readUInt32BE(offset + 8 + length)
    expect(crc).toBe(crc32(png.subarray(offset + 4, offset + 8 + length)))
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      expect([data[8], data[9]]).toEqual([8, 6])
    }
    if (type === 'IDAT') idat.push(data)
    offset += 12 + length
  }
  const raw = inflateSync(Buffer.concat(idat))
  const rgba = new Uint8Array(width * height * 4)
  for (let y = 0; y < height; y++) {
    const row = raw.subarray(y * (width * 4 + 1), (y + 1) * (width * 4 + 1))
    expect(row[0]).toBe(0)
    rgba.set(row.subarray(1), y * width * 4)
  }
  return { width, height, rgba }
}

describe('tray icon', () => {
  it('computes standard CRC-32 values', () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926)
    expect(crc32(new Uint8Array(0))).toBe(0)
  })

  it('encodes PNGs that decode back to the same pixels', () => {
    const pixels = new Uint8Array(3 * 2 * 4).map((_, i) => (i * 37) % 256)
    const { width, height, rgba } = decodePng(encodePng(3, 2, pixels))
    expect([width, height]).toEqual([3, 2])
    expect([...rgba]).toEqual([...pixels])
  })

  it('draws a black, left-right symmetric template glyph with soft edges', () => {
    const size = 36
    const px = rasterizeGlyph(size)
    let inked = 0
    let soft = 0
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const i = (y * size + x) * 4
        expect([px[i], px[i + 1], px[i + 2]]).toEqual([0, 0, 0])
        const alpha = px[i + 3] ?? 0
        const mirror = px[(y * size + (size - 1 - x)) * 4 + 3] ?? 0
        expect(Math.abs(alpha - mirror)).toBeLessThanOrEqual(1)
        if (alpha > 0) inked++
        if (alpha > 0 && alpha < 255) soft++
      }
    }
    expect(inked / (size * size)).toBeGreaterThan(0.05)
    expect(inked / (size * size)).toBeLessThan(0.5)
    expect(soft).toBeGreaterThan(0)
  })

  it('ships 1x and 2x images', () => {
    const { x1, x2 } = trayIconPngs()
    expect(decodePng(x1).width).toBe(18)
    expect(decodePng(x2).width).toBe(36)
  })
})

describe('tray menu', () => {
  function actions(capturing: boolean, orbVisible: boolean) {
    const calls: string[] = []
    const a: TrayActions = {
      openApp: () => void calls.push('open'),
      openSettings: () => void calls.push('settings'),
      toggleCapture: () => void calls.push('capture'),
      toggleOrb: () => void calls.push('orb'),
      quit: () => void calls.push('quit'),
      isCapturing: () => capturing,
      isOrbVisible: () => orbVisible,
    }
    return { a, calls }
  }

  it('lists the PLAN §5.2 items and flips labels with the state', () => {
    const on = menuTemplate(actions(true, true).a).map((i) => i.label ?? i.type)
    expect(on).toEqual([
      'Open Dumbledore',
      'Pause capture',
      'Hide orb',
      'Settings…',
      'separator',
      'Quit Dumbledore',
    ])
    const off = menuTemplate(actions(false, false).a).map((i) => i.label)
    expect(off).toContain('Resume capture')
    expect(off).toContain('Show orb')
  })

  it('shows the capture chord without registering it twice', () => {
    const capture = menuTemplate(actions(true, true).a)[1]
    expect(capture).toMatchObject({
      accelerator: 'Control+Alt+Command+P',
      registerAccelerator: false,
    })
  })
})
