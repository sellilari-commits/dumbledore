import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineOverlay } from '@shared/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OutlineFlow, union } from './outline-flow'

const TEXT = [
  'Carbocation – Wikipedia',
  'A carbocation is an ion with a positively charged carbon atom.',
  'Stability increases from methyl to primary, secondary and tertiary.',
  'Hyperconjugation donates electron density from adjacent C–H bonds.',
  'Inductive effects of alkyl groups also stabilise the cation.',
  'History: the term was coined in 1902.',
  'See also: carbanion, radical.',
  'References',
]

function page(): PerceivedWindow {
  return {
    pid: 1,
    bundleId: 'com.apple.Preview',
    appName: 'Preview',
    windowId: 7,
    title: 'Carbocation – Wikipedia',
    url: null,
    frame: { x: 0, y: 0, width: 800, height: 900 },
    source: 'ocr',
    changed: true,
    contentHash: 'h',
    capturedAt: '2026-10-25T09:00:00.000Z',
    lines: TEXT.map((text, i) => ({
      text,
      conf: 1,
      box: { x: 100, y: 100 + i * 30, width: 500, height: 20 },
      align: 'left' as const,
    })),
  }
}

describe('union', () => {
  it('covers every box', () => {
    expect(
      union([
        { x: 10, y: 10, width: 100, height: 20 },
        { x: 0, y: 40, width: 50, height: 20 },
      ]),
    ).toEqual({ x: 0, y: 10, width: 110, height: 50 })
  })
})

describe('OutlineFlow', () => {
  let repos: Repos
  let subjectId: string
  let shown: (OutlineOverlay | null)[]
  let inputs: OutlineInput[]
  const out: OutlineOutput = {
    summary: 'Explains why tertiary carbocations are the most stable.',
    ranges: [
      { from: 2, to: 4, verdict: 'read', why: 'Your gap: carbocation stability' },
      { from: 5, to: 7, verdict: 'skip', why: 'Off your goal' },
    ],
  }

  beforeEach(() => {
    repos = createMemoryRepos(new FakeClock())
    const s = repos.subjects.create({ name: 'Organic Chemistry' })
    subjectId = s.id
    repos.subjects.update(s.id, { goal: 'Pass the midterm' })
    const c = repos.concepts.upsert({ subjectId, name: 'Carbocation stability' })
    repos.concepts.update(c.id, { status: 'struggling', struggleCount: 2, mastery: 0.2 })
    const known = repos.concepts.upsert({ subjectId, name: 'SN2 mechanism' })
    repos.concepts.update(known.id, { status: 'mastered', mastery: 0.9 })
    shown = []
    inputs = []
  })

  const flow = (over: Partial<ConstructorParameters<typeof OutlineFlow>[0]> = {}) =>
    new OutlineFlow({
      repos,
      frontWindow: async () => page(),
      subjectFor: () => subjectId,
      outline: async (input) => {
        inputs.push(input)
        return out
      },
      show: (o) => void shown.push(o),
      changed: vi.fn(),
      ...over,
    })

  it('sends the page with the subject’s gaps and mastered concepts, then draws the marks', async () => {
    const result = await flow().run()
    expect(result).toEqual({ kind: 'shown', read: 1, marks: 2, subjectId })
    expect(inputs[0]?.gaps[0]).toEqual({ name: 'Carbocation stability', why: 'missed 2×' })
    expect(inputs[0]?.known).toEqual(['SN2 mechanism'])
    expect(inputs[0]?.subject).toEqual({ name: 'Organic Chemistry', goal: 'Pass the midterm' })
    const marks = shown[0]?.marks ?? []
    expect(marks[0]).toEqual({
      rect: { x: 100, y: 160, width: 500, height: 80 },
      verdict: 'read',
      why: 'Your gap: carbocation stability',
    })
    expect(shown[0]?.windowId).toBe(7)
  })

  it('saves each passage to read as a highlight note on the subject', async () => {
    const changed = vi.fn()
    await flow({ changed }).run()
    const notes = repos.notes.list({ subjectId })
    expect(notes).toHaveLength(1)
    expect(notes[0]?.kind).toBe('highlight')
    expect(notes[0]?.text).toContain('Stability increases from methyl')
    expect(notes[0]?.source.title).toBe('Carbocation – Wikipedia')
    expect(changed).toHaveBeenCalledWith(subjectId)
  })

  it('says when the page can’t be read or has no subject', async () => {
    expect(await flow({ frontWindow: async () => null }).run()).toEqual({ kind: 'unreadable' })
    expect(await flow({ subjectFor: () => null }).run()).toEqual({ kind: 'noSubject' })
    expect(shown).toEqual([])
  })
})
