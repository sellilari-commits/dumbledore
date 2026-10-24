/**
 * OCR accuracy of the real helper on synthetic screenshots with exact ground truth
 * (tests/fixtures/screens, drawn by native/helper/tools/RenderFixtures.swift). Runs
 * `dumbledore-helper ocr-file`, the same Vision pipeline `perceive` uses (settings, Å fix, reading
 * order, alignment), and checks: character accuracy ≥ 97 % per fixture, Nordic letters, alignment
 * hints, chat reading order, the dHash and the command's error exits. Skips when the helper is not
 * built (bash native/helper/build.sh). DUMBLEDORE_PERF=1 also enforces the 450 ms latency budget.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import {
  editDistance,
  GtDoc,
  type GtLine,
  type OcrFileOutput,
  type OcrLine,
  ocrFile,
  runHelper,
  type Score,
  score,
} from '../../native/helper/tools/ocr-score'

const ROOT = fileURLToPath(new URL('../..', import.meta.url))
const HELPER = join(ROOT, 'native/helper/build/dumbledore-helper')
const SCREENS = join(ROOT, 'tests/fixtures/screens')
const MIN_ACCURACY = 0.97

// ─── tests ──────────────────────────────────────────────────────────────────────────────────

const names = existsSync(SCREENS)
  ? readdirSync(SCREENS)
      .filter((f) => f.endsWith('.json') && existsSync(join(SCREENS, f.replace(/\.json$/, '.png'))))
      .map((f) => f.replace(/\.json$/, ''))
      .sort()
  : []
const built = existsSync(HELPER)
if (!built) console.warn(`helper-ocr: ${HELPER} is missing — run bash native/helper/build.sh`)

describe.skipIf(!built)('helper OCR on fixture screenshots', () => {
  const docs = new Map<string, GtDoc>()
  const outs = new Map<string, OcrFileOutput>()
  const scores = new Map<string, Score>()
  let rerun: OcrFileOutput

  beforeAll(async () => {
    for (const name of names) {
      docs.set(name, GtDoc.parse(JSON.parse(readFileSync(join(SCREENS, `${name}.json`), 'utf8'))))
      outs.set(name, await ocrFile(HELPER, join(SCREENS, `${name}.png`)))
    }
    rerun = await ocrFile(HELPER, join(SCREENS, 'document.png'))
    for (const name of names) {
      const s = score(docs.get(name)?.lines ?? [], outs.get(name)?.lines ?? [])
      scores.set(name, s)
      const misses = s.groups.filter((g) => g.errors > 0)
      console.info(
        `${name}: ${(s.accuracy * 100).toFixed(2)} % (${s.errors}/${s.chars} errors, ${outs.get(name)?.ms} ms)` +
          misses.map((g) => `\n  expected «${g.expected}»\n  got      «${g.got}»`).join(''),
      )
    }
  }, 120_000)

  it('has the fixture set', () => {
    expect(names).toEqual(
      expect.arrayContaining([
        'chat-dark',
        'chat-light',
        'document',
        'slide',
        'two-column',
        'ui-small',
      ]),
    )
  })

  it.each(names)('%s: character accuracy ≥ 97 %%', (name) => {
    const doc = docs.get(name)
    const out = outs.get(name)
    expect(out?.width).toBe((doc?.width ?? 0) * 2)
    expect(out?.height).toBe((doc?.height ?? 0) * 2)
    expect(scores.get(name)?.accuracy).toBeGreaterThanOrEqual(MIN_ACCURACY)
  })

  it('keeps Finnish and Swedish letters (ä, ö, å, Å — no Romanian Ă)', () => {
    const text = (name: string) => (outs.get(name)?.lines ?? []).map((l) => l.text).join('\n')
    const doc = text('document')
    for (const word of [
      'käyttävät',
      'Ahvenanmaalla',
      'Åland',
      'Långvikissa',
      'yöt',
      'använder',
      'växterna',
    ])
      expect(doc).toContain(word)
    expect(text('chat-light')).toContain('Åland')
    expect(names.map(text).join('\n')).not.toMatch(/[Ăă]/)
  })

  /** Ground-truth lines with an expected alignment vs the helper's `align` on their OCR lines. */
  function alignment(fixtures: string[]): { checked: number; misses: string[] } {
    let checked = 0
    const misses: string[] = []
    for (const name of fixtures) {
      const gt = docs.get(name)?.lines ?? []
      const ocr = outs.get(name)?.lines ?? []
      for (const g of scores.get(name)?.groups ?? []) {
        const want = g.gt.length === 1 ? gt[g.gt[0] ?? -1]?.align : undefined
        if (!want) continue
        for (const j of g.ocr) {
          checked++
          const got = ocr[j]?.align
          if (got !== want) misses.push(`${name}: «${ocr[j]?.text}» ${got}, expected ${want}`)
        }
      }
    }
    return { checked, misses }
  }

  it('reports the expected alignment in documents, slides and settings', () => {
    const r = alignment(names.filter((n) => !n.startsWith('chat')))
    expect(r.checked).toBeGreaterThan(15)
    expect(r.misses.length / r.checked).toBeLessThanOrEqual(0.05)
  })

  it('tells chat roles apart by alignment (most user lines right, assistant lines left)', () => {
    for (const name of ['chat-light', 'chat-dark']) {
      const gt = docs.get(name)?.lines ?? []
      const ocr = outs.get(name)?.lines ?? []
      const votes = { user: { hits: 0, total: 0 }, assistant: { hits: 0, total: 0 } }
      for (const g of scores.get(name)?.groups ?? []) {
        const role = g.gt.length === 1 ? gt[g.gt[0] ?? -1]?.role : undefined
        if (!role) continue
        for (const j of g.ocr) {
          votes[role].total++
          if (ocr[j]?.align === (role === 'user' ? 'right' : 'left')) votes[role].hits++
        }
      }
      const r = alignment([name])
      if (r.misses.length) console.info(`alignment misses:\n  ${r.misses.join('\n  ')}`)
      for (const { hits, total } of Object.values(votes)) {
        expect(total).toBeGreaterThanOrEqual(4)
        expect(hits / total).toBeGreaterThan(0.5)
      }
    }
  })

  // Known issue in native/helper Layout.swift (reported in docs/progress/L1b-helper-tests.md):
  // rows below the sidebar are measured against the whole window (assistant text and the centred
  // footer read as `right`), and a multi-line user bubble split off as its own column reads its
  // widest line as `left`. Flip to it() once the helper gets these right.
  it.fails('known issue: every chat line has its role alignment', () => {
    expect(alignment(['chat-light', 'chat-dark']).misses).toEqual([])
  })

  it('reads chat turns in conversation order', () => {
    for (const name of ['chat-light', 'chat-dark']) {
      const gt = docs.get(name)?.lines ?? []
      const owner = new Map<number, number>()
      for (const g of scores.get(name)?.groups ?? [])
        for (const j of g.ocr) if (g.gt.length > 0) owner.set(j, g.gt[0] ?? -1)
      const order = (outs.get(name)?.lines ?? [])
        .map((_, j) => owner.get(j) ?? -1)
        .filter((i) => gt[i]?.role !== undefined)
      expect(order.length).toBeGreaterThan(10)
      expect(order).toEqual([...order].sort((a, b) => a - b))
    }
  })

  it('computes a stable dHash that differs between screens', () => {
    expect(rerun.dhash).toBe(outs.get('document')?.dhash)
    expect(rerun.lines.map((l) => l.text)).toEqual(outs.get('document')?.lines.map((l) => l.text))
    const hashes = new Set(names.map((n) => outs.get(n)?.dhash))
    expect(hashes.size).toBe(names.length)
  })

  it('stays within the latency budget', () => {
    const times = names.map((n) => outs.get(n)?.ms ?? Number.POSITIVE_INFINITY)
    console.info(`ocr-file ms: ${times.join(', ')}; warm document rerun ${rerun.ms} ms`)
    for (const ms of times) expect(ms).toBeLessThan(5_000) // sanity bound on a busy machine
    if (process.env.DUMBLEDORE_PERF === '1') {
      const sorted = [...times].sort((a, b) => a - b)
      expect(sorted[Math.floor(sorted.length / 2)]).toBeLessThanOrEqual(450)
    }
  })

  it('fails cleanly on bad arguments', async () => {
    const usage = await runHelper(HELPER, ['ocr-file'])
    expect(usage.code).toBe(2)
    expect(usage.stderr).toContain('usage: ocr-file')
    const missing = await runHelper(HELPER, [
      'ocr-file',
      '--image',
      join(SCREENS, 'does-not-exist.png'),
    ])
    expect(missing.code).toBe(1)
    expect(missing.stderr).toContain('cannot read image')
  })
})

describe('OCR scoring', () => {
  const line = (text: string, x: number, y: number, w: number): GtLine => ({
    text,
    x,
    y,
    w,
    h: 20,
    size: 16,
  })
  const ocr = (text: string, x: number, y: number, width: number): OcrLine => ({
    text,
    conf: 1,
    box: { x, y: y + 2, width, height: 16 },
    align: 'left',
  })

  it('counts edits, splits, merges, misses and extra text', () => {
    expect(editDistance('kitten', 'sitting')).toBe(3)
    expect(editDistance('å', 'a')).toBe(1)
    const gt = [
      line('left column', 0, 0, 100),
      line('right column', 200, 0, 100),
      line('next', 0, 30, 40),
    ]
    const merged = score(gt, [ocr('left column right column', 0, 0, 300), ocr('next', 0, 30, 40)])
    expect(merged.errors).toBe(0)
    const split = score(
      [line('one long line', 0, 0, 300)],
      [ocr('long line', 100, 0, 200), ocr('one', 0, 0, 60)],
    )
    expect(split.errors).toBe(0)
    const noisy = score(gt, [ocr('left colunn', 0, 0, 100), ocr('stray', 500, 300, 50)])
    expect(noisy.errors).toBe(1 + 'right column'.length + 'next'.length + 'stray'.length)
    expect(noisy.chars).toBe('left column'.length + 'right column'.length + 'next'.length)
  })
})
