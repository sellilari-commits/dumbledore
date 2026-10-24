/**
 * Outline end to end through the shell: a right-⌥ tap on a page being read reads it fresh,
 * marks the passage that covers the subject's gap, shows the marks on the overlay, saves the
 * passage as a highlight note; a second tap clears the marks.
 */
import { describe, expect, it } from 'vitest'
import { createHarness, flush } from '../testing/harness'

const LINES = [
  'Carbocation',
  'A carbocation is an ion with a positively charged carbon atom.',
  'Carbocation stability increases from methyl to tertiary.',
  'Hyperconjugation spreads the positive charge.',
  'History: the term was coined in 1902.',
  'See also: carbanion.',
  'References',
]

describe('outline wiring', () => {
  it('a tap on a page being read marks your gap and saves it; a second tap clears', async () => {
    const h = await createHarness({ seed: false })
    const { repos } = h.services
    const subject = repos.subjects.create({ name: 'Organic Chemistry' })
    const gap = repos.concepts.upsert({ subjectId: subject.id, name: 'Carbocation stability' })
    repos.concepts.update(gap.id, { status: 'struggling', struggleCount: 2, mastery: 0.2 })
    h.perception.setNow({
      app: 'Preview',
      title: 'Carbocation.pdf',
      url: null,
      minutes: 3,
      kind: 'reading',
      subjectId: subject.id,
      suggestion: null,
    })
    h.helper.respond('perceive', (params) => {
      expect(params).toMatchObject({ scope: 'frontmost', fresh: true })
      return {
        windows: [
          {
            pid: 42,
            bundleId: 'com.apple.Preview',
            appName: 'Preview',
            windowId: 9,
            title: 'Carbocation.pdf',
            url: null,
            frame: { x: 0, y: 0, width: 900, height: 900 },
            source: 'ocr',
            changed: true,
            contentHash: 'h1',
            capturedAt: '2026-10-25T10:00:00.000Z',
            lines: LINES.map((text, i) => ({
              text,
              conf: 1,
              box: { x: 80, y: 100 + i * 24, width: 600, height: 18 },
              align: 'left' as const,
            })),
          },
        ],
      }
    })

    expect(await h.core.router.gesture('tap', { source: 'chord' })).toEqual({ kind: 'outline' })
    await flush()
    const shown = h.overlayStates.at(-1)?.outline
    expect(shown?.subjectName).toBe('Organic Chemistry')
    expect(shown?.marks).toEqual([
      {
        rect: { x: 80, y: 148, width: 600, height: 18 },
        verdict: 'read',
        why: 'Your gap: Carbocation stability',
      },
    ])
    const notes = repos.notes.list({ subjectId: subject.id })
    expect(notes.map((n) => [n.kind, n.text])).toEqual([
      ['highlight', 'Carbocation stability increases from methyl to tertiary.'],
    ])

    expect(await h.core.router.gesture('tap', { source: 'chord' })).toEqual({
      kind: 'clearOutline',
    })
    expect(h.overlayStates.at(-1)?.outline).toBeNull()
  })
})
