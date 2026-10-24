/**
 * The menu-bar icon, drawn in code so no binary asset is needed: Dumbledore's mark (half-moon
 * spectacles over a beard, `@shared/brand-mark`) as an anti-aliased black-on-transparent PNG
 * (a macOS template image), at 1× and 2×. The same rasterizer draws the app icon
 * (`tools/brand/build-icons.ts`). Includes a tiny PNG encoder (RGBA, zlib, CRC-32).
 */
import { deflateSync } from 'node:zlib'
import {
  BEARD,
  type Contour,
  flattenContour,
  MARK_BOX,
  MARK_STROKE,
  type Point,
  SMILE,
  SPECTACLES,
  type StrokeShape,
} from '@shared/brand-mark'

const BOX = 18
/** A touch heavier than the in-app glyph so the spectacles hold up at 18 px. */
const TRAY_STROKE = 2.1

function distToSegment(px: number, py: number, s: Extract<StrokeShape, { kind: 'line' }>): number {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2))
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy))
}

function distToArc(px: number, py: number, s: Extract<StrokeShape, { kind: 'arc' }>): number {
  let angle = Math.atan2(py - s.cy, px - s.cx)
  if (angle < s.a0) angle += 2 * Math.PI
  if (angle >= s.a0 && angle <= s.a1) return Math.abs(Math.hypot(px - s.cx, py - s.cy) - s.r)
  const end = (a: number) =>
    Math.hypot(px - (s.cx + s.r * Math.cos(a)), py - (s.cy + s.r * Math.sin(a)))
  return Math.min(end(s.a0), end(s.a1))
}

/** Distance to the nearest polygon edge, negative inside (even-odd over all polygons). */
function signedDistToFill(px: number, py: number, polys: readonly Point[][]): number {
  let d = Number.POSITIVE_INFINITY
  let inside = false
  for (const poly of polys) {
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const [x1, y1] = poly[j] as Point
      const [x2, y2] = poly[i] as Point
      if (y1 > py !== y2 > py && px < ((x2 - x1) * (py - y1)) / (y2 - y1) + x1) inside = !inside
      d = Math.min(d, distToSegment(px, py, { kind: 'line', x1, y1, x2, y2 }))
    }
  }
  return inside ? -d : d
}

export interface MarkOptions {
  /** Cut the smile out of the beard. */
  smile?: boolean
  /** Spectacles stroke width in mark units (24-unit box). */
  strokeWidth?: number
}

/** Coverage (0..1) of the mark drawn into a `size`×`size` square, row by row. */
export function rasterizeMark(size: number, options: MarkOptions = {}): Float32Array {
  const scale = size / MARK_BOX
  const half = (options.strokeWidth ?? MARK_STROKE) / 2
  const contours: Contour[] = options.smile ? [BEARD, SMILE] : [BEARD]
  const polys = contours.map((c) => flattenContour(c))
  const out = new Float32Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / scale
      const gy = (y + 0.5) / scale
      let d = Number.POSITIVE_INFINITY
      for (const s of SPECTACLES) {
        d = Math.min(d, s.kind === 'line' ? distToSegment(gx, gy, s) : distToArc(gx, gy, s))
      }
      const stroke = (half - d) * scale + 0.5
      const fill = -signedDistToFill(gx, gy, polys) * scale + 0.5
      out[y * size + x] = Math.max(0, Math.min(1, Math.max(stroke, fill)))
    }
  }
  return out
}

/** RGBA pixels of the tray glyph at `size`×`size`: black, alpha = coverage. */
export function rasterizeGlyph(size: number): Uint8Array {
  const coverage = rasterizeMark(size, { strokeWidth: TRAY_STROKE })
  const out = new Uint8Array(size * size * 4)
  for (let i = 0; i < coverage.length; i++) out[i * 4 + 3] = Math.round((coverage[i] ?? 0) * 255)
  return out
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (const byte of data) c = (CRC_TABLE[(c ^ byte) & 0xff] ?? 0) ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type: string, data: Uint8Array): Buffer {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(data.length, 0)
  head.write(type, 4, 'ascii')
  const body = Buffer.concat([head.subarray(4), Buffer.from(data)])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body), 0)
  return Buffer.concat([head.subarray(0, 4), body, crc])
}

/** Encodes RGBA pixels as a PNG (8-bit, colour type 6, no filtering). */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0
    Buffer.from(rgba.subarray(y * width * 4, (y + 1) * width * 4)).copy(
      raw,
      y * (width * 4 + 1) + 1,
    )
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', new Uint8Array(0)),
  ])
}

/** PNGs of the tray glyph at 1× (18 px) and 2× (36 px). */
export function trayIconPngs(): { x1: Buffer; x2: Buffer } {
  return {
    x1: encodePng(BOX, BOX, rasterizeGlyph(BOX)),
    x2: encodePng(BOX * 2, BOX * 2, rasterizeGlyph(BOX * 2)),
  }
}
