/**
 * OCR scoring for the helper's fixture test (tests/integration/helper-ocr.test.ts) and benchmarks:
 * the ground-truth format of tests/fixtures/screens/*.json (written by RenderFixtures.swift), the
 * output of `dumbledore-helper ocr-file`, a runner for it, and an order-independent character
 * accuracy score (edit distance over grouped lines, so split and merged lines compare as a whole).
 */
import { execFile } from 'node:child_process'
import { TextLine } from '@shared/helper-protocol'
import { z } from 'zod'

export const GtLine = z.object({
  text: z.string(),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
  size: z.number(),
  align: z.enum(['left', 'center', 'right']).optional(),
  role: z.enum(['user', 'assistant']).optional(),
})
export type GtLine = z.infer<typeof GtLine>
export const GtDoc = z.object({
  name: z.string(),
  width: z.number(),
  height: z.number(),
  scale: z.number(),
  lines: z.array(GtLine),
})
export type GtDoc = z.infer<typeof GtDoc>
export const OcrFileOutput = z.object({
  width: z.number().int(),
  height: z.number().int(),
  scale: z.number(),
  ms: z.number(),
  dhash: z.string().regex(/^[0-9a-f]{16}$/),
  lines: z.array(TextLine),
})
export type OcrFileOutput = z.infer<typeof OcrFileOutput>
export type OcrLine = OcrFileOutput['lines'][number]

export interface HelperRun {
  code: number
  stdout: string
  stderr: string
}

export function runHelper(helper: string, args: string[], timeoutMs = 30_000): Promise<HelperRun> {
  return new Promise((resolve) => {
    execFile(helper, args, { timeout: timeoutMs, maxBuffer: 16 << 20 }, (error, stdout, stderr) => {
      const code = error ? (typeof error.code === 'number' ? error.code : -1) : 0
      resolve({ code, stdout, stderr })
    })
  })
}

/** OCRs a PNG with the helper's perceive pipeline; `scale` is the image's pixels per point. */
export async function ocrFile(helper: string, png: string, scale = 2): Promise<OcrFileOutput> {
  const run = await runHelper(helper, ['ocr-file', '--image', png, '--scale', String(scale)])
  if (run.code !== 0) throw new Error(`ocr-file failed (${run.code}): ${run.stderr}`)
  return OcrFileOutput.parse(JSON.parse(run.stdout))
}

// ─── character accuracy ─────────────────────────────────────────────────────────────────────

export const normalize = (s: string): string => s.normalize('NFC').replace(/\s+/g, ' ').trim()

/** Levenshtein distance over code points. */
export function editDistance(a: string, b: string): number {
  const x = Array.from(a)
  const y = Array.from(b)
  let prev = Array.from({ length: y.length + 1 }, (_, j) => j)
  for (let i = 1; i <= x.length; i++) {
    const cur = [i]
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(
        (prev[j] ?? 0) + 1,
        (cur[j - 1] ?? 0) + 1,
        (prev[j - 1] ?? 0) + (x[i - 1] === y[j - 1] ? 0 : 1),
      )
    }
    prev = cur
  }
  return prev[y.length] ?? 0
}

const overlap = (a0: number, a1: number, b0: number, b1: number) =>
  Math.max(0, Math.min(a1, b1) - Math.max(a0, b0))

/** An OCR line belongs to a ground-truth line when their boxes share most of a row. */
export function sameLine(gt: GtLine, o: OcrLine): boolean {
  if (!o.box) return false
  const b = o.box
  const v = overlap(gt.y, gt.y + gt.h, b.y, b.y + b.height) / Math.min(gt.h, b.height)
  const h = overlap(gt.x, gt.x + gt.w, b.x, b.x + b.width) / Math.min(gt.w, b.width)
  return v >= 0.5 && h >= 0.5
}

export interface Group {
  gt: number[]
  ocr: number[]
  expected: string
  got: string
  errors: number
}

export interface Score {
  accuracy: number
  errors: number
  chars: number
  groups: Group[]
}

/**
 * Groups ground-truth and OCR lines that overlap (connected components, so split and merged lines
 * compare as a whole), then sums edit distances. Unmatched OCR text counts as insertions, missed
 * lines as deletions. Independent of the helper's reading order (tested separately).
 */
export function score(gt: GtLine[], ocr: OcrLine[]): Score {
  const edges = gt.map((g) => ocr.flatMap((o, j) => (sameLine(g, o) ? [j] : [])))
  const gtSeen = new Set<number>()
  const ocrSeen = new Set<number>()
  const groups: Group[] = []
  const build = (seedGt: number[], seedOcr: number[]): Group => {
    const g = new Set(seedGt)
    const o = new Set(seedOcr)
    for (let grew = true; grew; ) {
      grew = false
      for (let i = 0; i < gt.length; i++) {
        const js = edges[i] ?? []
        if (g.has(i)) {
          for (const j of js) {
            if (o.has(j)) continue
            o.add(j)
            grew = true
          }
        } else if (js.some((j) => o.has(j))) {
          g.add(i)
          grew = true
        }
      }
    }
    const gtIdx = [...g].sort((a, b) => a - b)
    const firstGt = (j: number) => gtIdx.find((i) => edges[i]?.includes(j)) ?? 0
    const ocrIdx = [...o].sort(
      (a, b) => firstGt(a) - firstGt(b) || (ocr[a]?.box?.x ?? 0) - (ocr[b]?.box?.x ?? 0),
    )
    const expected = normalize(gtIdx.map((i) => gt[i]?.text ?? '').join(' '))
    const got = normalize(ocrIdx.map((j) => ocr[j]?.text ?? '').join(' '))
    for (const i of gtIdx) gtSeen.add(i)
    for (const j of ocrIdx) ocrSeen.add(j)
    return { gt: gtIdx, ocr: ocrIdx, expected, got, errors: editDistance(expected, got) }
  }
  gt.forEach((_, i) => {
    if (!gtSeen.has(i)) groups.push(build([i], []))
  })
  ocr.forEach((_, j) => {
    if (!ocrSeen.has(j)) groups.push(build([], [j]))
  })
  const errors = groups.reduce((n, g) => n + g.errors, 0)
  const chars = groups.reduce((n, g) => n + Array.from(g.expected).length, 0)
  return { accuracy: Math.max(0, 1 - errors / chars), errors, chars, groups }
}
