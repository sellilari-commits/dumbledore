/**
 * Builds Dumbledore's icon files from the mark in `src/shared/brand-mark.ts`, with the same
 * rasterizer as the menu-bar icon (no browser needed). Run: `npm run icons`.
 *
 *   resources/icon.icns, icon.png     app icon (electron-builder's buildResources is resources/)
 *   resources/brand/mark.svg          the mark alone, in currentColor
 *   resources/brand/favicon.svg|.ico  ink rounded square with a white mark
 *
 * The app icon follows Apple's 1024 grid: an 824 px rounded tile 100 px in, a soft
 * shadow, the white mark centred on ink (#2C2C2B) with the smile showing through.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { encodePng, rasterizeMark } from '../../src/main/tray-icon'
import { BEARD, fillPath, MARK_BOX, markSvg, spectaclesPath } from '../../src/shared/brand-mark'

const ROOT = resolve(import.meta.dirname, '../..')
const INK: readonly [number, number, number] = [0x2c, 0x2c, 0x2b]
const WHITE: readonly [number, number, number] = [0xff, 0xff, 0xff]
/** Visual centre of the mark in box units (spectacles top to beard tip). */
const MARK_CENTRE: readonly [number, number] = [12, 13.7]

const clamp01 = (v: number) => Math.max(0, Math.min(1, v))

interface Layout {
  /** Tile edge as a fraction of the canvas. */
  tile: number
  /** Corner radius as a fraction of the tile edge. */
  radius: number
  /** Mark box edge as a fraction of the canvas. */
  mark: number
  shadow: boolean
}

const APP: Layout = { tile: 824 / 1024, radius: 0.225, mark: 600 / 1024, shadow: true }
const FAVICON: Layout = { tile: 1, radius: 0.25, mark: 26 / 32, shadow: false }

/** Signed distance (px) to a rounded square of half-size `h`, corner radius `r`, at the origin. */
function roundedSquareDist(x: number, y: number, h: number, r: number): number {
  const qx = Math.abs(x) - (h - r)
  const qy = Math.abs(y) - (h - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}

/** RGBA pixels of the icon at `size` px. */
function renderIcon(size: number, layout: Layout): Uint8Array {
  const half = (layout.tile * size) / 2
  const radius = layout.radius * layout.tile * size
  const centre = size / 2
  // Smaller icons get a heavier stroke and no smile so the mark stays legible.
  const markSize = Math.round(layout.mark * size)
  const mark = rasterizeMark(markSize, {
    smile: size >= 64,
    strokeWidth: size <= 32 ? 2.3 : size <= 64 ? 1.9 : 1.5,
  })
  const scale = markSize / MARK_BOX
  const mx = Math.round(centre - MARK_CENTRE[0] * scale)
  const my = Math.round(centre - MARK_CENTRE[1] * scale)
  const blur = size * 0.035
  const drop = size * 0.012

  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const px = x + 0.5 - centre
      const py = y + 0.5 - centre
      const tileA = clamp01(0.5 - roundedSquareDist(px, py, half, radius))
      let shadowA = 0
      if (layout.shadow) {
        const d = roundedSquareDist(px, py - drop, half, radius)
        shadowA = 0.32 * (1 - clamp01((d + blur * 0.25) / blur)) ** 2
      }
      const inMark = x - mx >= 0 && x - mx < markSize && y - my >= 0 && y - my < markSize
      const m = inMark ? (mark[(y - my) * markSize + (x - mx)] ?? 0) : 0
      const a = tileA + shadowA * (1 - tileA)
      const i = (y * size + x) * 4
      if (a > 0) {
        // Tile colour over a black shadow, un-premultiplied for PNG.
        for (let c = 0; c < 3; c++) {
          const tile = (INK[c] as number) * (1 - m) + (WHITE[c] as number) * m
          out[i + c] = Math.round((tile * tileA) / a)
        }
      }
      out[i + 3] = Math.round(a * 255)
    }
  }
  return out
}

function png(size: number, layout: Layout): Buffer {
  return encodePng(size, size, renderIcon(size, layout))
}

/** An .ico holding PNG images (supported since Windows Vista and by every browser). */
function encodeIco(images: { size: number; data: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + images.length * 16)
  head.writeUInt16LE(0, 0)
  head.writeUInt16LE(1, 2)
  head.writeUInt16LE(images.length, 4)
  let offset = head.length
  images.forEach(({ size, data }, k) => {
    const e = 6 + k * 16
    head[e] = size >= 256 ? 0 : size
    head[e + 1] = size >= 256 ? 0 : size
    head.writeUInt16LE(1, e + 4)
    head.writeUInt16LE(32, e + 6)
    head.writeUInt32LE(data.length, e + 8)
    head.writeUInt32LE(offset, e + 12)
    offset += data.length
  })
  return Buffer.concat([head, ...images.map((im) => im.data)])
}

function faviconSvg(): string {
  const s = (FAVICON.mark * 32) / MARK_BOX
  const tx = 16 - MARK_CENTRE[0] * s
  const ty = 16 - MARK_CENTRE[1] * s
  return [
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">',
    '<rect width="32" height="32" rx="8" fill="#2c2c2b"/>',
    `<g transform="translate(${tx.toFixed(3)} ${ty.toFixed(3)}) scale(${s.toFixed(4)})">`,
    `<path d="${spectaclesPath()}" fill="none" stroke="#fff" stroke-width="2.3" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="${fillPath([BEARD])}" fill="#fff"/>`,
    '</g></svg>',
  ].join('')
}

function run(cmd: string, args: string[]): void {
  const r = spawnSync(cmd, args, { stdio: 'inherit' })
  if (r.status !== 0) throw new Error(`${cmd} failed`)
}

function main(): void {
  const buildDir = join(ROOT, 'resources')
  const brandDir = join(ROOT, 'resources/brand')
  mkdirSync(brandDir, { recursive: true })

  writeFileSync(join(buildDir, 'icon.png'), png(1024, APP))

  const iconset = join(mkdtempSync(join(tmpdir(), 'dd-icons-')), 'icon.iconset')
  mkdirSync(iconset)
  for (const base of [16, 32, 128, 256, 512]) {
    writeFileSync(join(iconset, `icon_${base}x${base}.png`), png(base, APP))
    writeFileSync(join(iconset, `icon_${base}x${base}@2x.png`), png(base * 2, APP))
  }
  run('iconutil', ['-c', 'icns', iconset, '-o', join(buildDir, 'icon.icns')])
  rmSync(resolve(iconset, '..'), { recursive: true, force: true })

  writeFileSync(join(brandDir, 'mark.svg'), `${markSvg()}\n`)
  writeFileSync(join(brandDir, 'favicon.svg'), `${faviconSvg()}\n`)
  writeFileSync(
    join(brandDir, 'favicon.ico'),
    encodeIco([16, 32, 48].map((size) => ({ size, data: png(size, FAVICON) }))),
  )
  console.log('icons → resources/icon.icns, resources/icon.png, resources/brand/')
}

main()
