import type { OutlineInput } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { cleanRanges, outlinePrompt } from './p15-outline'

const input: OutlineInput = {
  subject: { name: 'Organic Chemistry', goal: 'Pass the midterm' },
  page: { title: 'Carbocation', app: 'Preview' },
  gaps: [{ name: 'Carbocation stability', why: 'missed 2×' }],
  known: ['SN2 mechanism'],
  openQuestions: ['Is hyperconjugation the same as resonance?'],
  lines: Array.from({ length: 10 }, (_, i) => ({ i, text: `line ${i}` })),
  language: 'en',
}

describe('P15 outline', () => {
  it('puts the gaps, known concepts and numbered page in the prompt', () => {
    const { user } = outlinePrompt.build(input, { onDevice: false, today: '2026-10-25' })
    expect(user).toContain('Carbocation stability (missed 2×)')
    expect(user).toContain('SN2 mechanism')
    expect(user).toContain('3: line 3')
  })

  it('cleans ranges: page order, clamped to the page, no overlaps, short reasons', () => {
    const ranges = cleanRanges(
      {
        summary: '',
        ranges: [
          { from: 6, to: 12, verdict: 'skip', why: 'Off topic' },
          {
            from: 2,
            to: 4,
            verdict: 'read',
            why: 'Your gap: carbocation stability and more words here',
          },
          { from: 3, to: 5, verdict: 'skim', why: 'Background' },
          { from: 4, to: 4, verdict: 'skim', why: 'Inside' },
        ],
      },
      input,
    )
    expect(ranges.map((r) => [r.from, r.to, r.verdict])).toEqual([
      [2, 4, 'read'],
      [5, 5, 'skim'],
      [6, 9, 'skip'],
    ])
    expect(ranges[0]?.why.split(' ').length).toBe(8)
  })

  it('asks for a repair when nothing is marked to read', () => {
    expect(outlinePrompt.check?.({ summary: '', ranges: [] }, input)).toEqual([
      'mark at least one passage to read',
    ])
  })
})
