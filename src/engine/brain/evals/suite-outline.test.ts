import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { loadFixture } from './common'
import { type OutlineCase, scoreOutline, screenLines, sentLines } from './suite-outline'

const root = resolve(__dirname, '../../../..')
const { cases } = loadFixture<{ cases: OutlineCase[] }>(root, 'outline-pages.json')

describe('outline eval fixture', () => {
  it('has every label on the line it names', () => {
    for (const c of cases) {
      for (const l of [...c.mustRead, ...c.mustNotRead]) {
        expect(c.lines[l.line], `${c.id}: ${l.text}`).toContain(l.text)
      }
    }
  })

  it('sends every must-read passage when the whole page is read, few from the first screen', () => {
    for (const c of cases) {
      const whole = new Set(sentLines(c, 'whole'))
      for (const l of c.mustRead) expect(whole.has(l.line), `${c.id} line ${l.line}`).toBe(true)
      const screen = sentLines(c, 'screen')
      expect(Math.max(...screen)).toBeLessThan(screenLines(c.lines))
    }
    // Most must-read passages sit below the first screen: what whole-page reading is for.
    const deep = cases.flatMap((c) => c.mustRead.filter((l) => l.line >= screenLines(c.lines)))
    expect(deep.length).toBeGreaterThan(cases.length)
  })
})

describe('scoreOutline', () => {
  it('counts must-read hits, misses, false reads and the share marked READ', () => {
    const c: OutlineCase = {
      id: 'x',
      title: 'T',
      url: 'u',
      subject: 'S',
      goal: null,
      gaps: [],
      known: [],
      openQuestions: [],
      lines: ['aaaa', 'bbbb', 'cccc', 'dddd'],
      mustRead: [
        { text: 'bbbb', why: '', line: 1 },
        { text: 'dddd', why: '', line: 3 },
      ],
      mustNotRead: [{ text: 'cccc', why: '', line: 2 }],
    }
    // Sent: lines 0, 1, 3 (2 was left out); P15 marks sent 1–2 = lines 1 and 3.
    const s = scoreOutline(c, [0, 1, 3], {
      summary: '',
      ranges: [{ from: 1, to: 2, verdict: 'read', why: 'Your gap' }],
    })
    expect(s.hits.map((l) => l.line)).toEqual([1, 3])
    expect(s.missed).toEqual([])
    expect(s.falseReads).toEqual([])
    expect(s.readShare).toBe(0.667)
    expect(s.reads).toEqual([{ from: 1, to: 3, why: 'Your gap' }])
  })
})
