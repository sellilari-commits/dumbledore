/**
 * The menu-bar icon, drawn in code so no binary asset is needed: Dumbledore's half-moon
 * spectacles as an anti-aliased black-on-transparent PNG (a macOS template image), at 1× and 2×.
 * Includes a tiny PNG encoder (RGBA, zlib, CRC-32).
 */
import { deflateSync } from 'node:zlib'

type Shape =
  | { kind: 'line'; x1: number; y1: number; x2: number; y2: number }
  | { kind: 'arc'; cx: number; cy: number; r: number; a0: number; a1: number }

/** Glyph in an 18×18 box, y down. Angles 0..π run through the lower half of a circle. */
const GLYPH: Shape[] = [
  { kind: 'line', x1: 2, y1: 8, x2: 8, y2: 8 },
  { kind: 'arc', cx: 5, cy: 8, r: 3, a0: 0, a1: Math.PI },
  { kind: 'line', x1: 10, y1: 8, x2: 16, y2: 8 },
  { kind: 'arc', cx: 13, cy: 8, r: 3, a0: 0, a1: Math.PI },
  { kind: 'arc', cx: 9, cy: 8, r: 1, a0: Math.PI, a1: 2 * Math.PI },
  { kind: 'line', x1: 2, y1: 8, x2: 0.9, y2: 6.1 },
  { kind: 'line', x1: 16, y1: 8, x2: 17.1, y2: 6.1 },
]
const BOX = 18
const HALF_STROKE = 0.72

function distToSegment(px: number, py: number, s: Extract<Shape, { kind: 'line' }>): number {
  const dx = s.x2 - s.x1
  const dy = s.y2 - s.y1
  const len2 = dx * dx + dy * dy
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.x1) * dx + (py - s.y1) * dy) / len2))
  return Math.hypot(px - (s.x1 + t * dx), py - (s.y1 + t * dy))
}

function distToArc(px: number, py: number, s: Extract<Shape, { kind: 'arc' }>): number {
  let angle = Math.atan2(py - s.cy, px - s.cx)
  if (angle < s.a0) angle += 2 * Math.PI
  if (angle >= s.a0 && angle <= s.a1) return Math.abs(Math.hypot(px - s.cx, py - s.cy) - s.r)
  const end = (a: number) =>
    Math.hypot(px - (s.cx + s.r * Math.cos(a)), py - (s.cy + s.r * Math.sin(a)))
  return Math.min(end(s.a0), end(s.a1))
}

/** RGBA pixels of the glyph at `size`×`size`. */
export function rasterizeGlyph(size: number): Uint8Array {
  const scale = size / BOX
  const out = new Uint8Array(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / scale
      const gy = (y + 0.5) / scale
      let d = Number.POSITIVE_INFINITY
      for (const s of GLYPH) {
        d = Math.min(d, s.kind === 'line' ? distToSegment(gx, gy, s) : distToArc(gx, gy, s))
      }
      const coverage = Math.max(0, Math.min(1, (HALF_STROKE - d) * scale + 0.5))
      out[(y * size + x) * 4 + 3] = Math.round(coverage * 255)
    }
  }
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
