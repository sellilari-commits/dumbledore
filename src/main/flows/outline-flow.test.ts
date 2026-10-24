import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineOverlay } from '@shared/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isCitation, OutlineFlow, pageLines, union } from './outline-flow'

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
    expect(inputs[0]?.gaps[0]).toEqual({ name: 'Carbocation stability', why: 'stuck 2×' })
    expect(inputs[0]?.known).toEqual(['SN2 mechanism'])
    expect(inputs[0]?.subject).toEqual({ name: 'Organic Chemistry', goal: 'Pass the midterm' })
    const marks = shown[0]?.marks ?? []
    expect(marks[0]).toMatchObject({
      rect: { x: 100, y: 160, width: 500, height: 80 },
      verdict: 'read',
      why: 'Your gap: carbocation stability',
      order: 1,
    })
    expect(marks[0]?.lines).toHaveLength(3)
    expect(marks[1]?.order).toBeNull()
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
    expect(await flow({ frontWindow: async () => 'private' }).run()).toEqual({ kind: 'private' })
    expect(await flow({ subjectFor: () => null }).run()).toEqual({ kind: 'noSubject' })
    expect(shown).toEqual([])
  })

  it('follows a scroll: the marks move with their text, and clear when the window changes', async () => {
    let tick: () => void = () => {}
    let current: PerceivedWindow | null = page()
    const f = flow({
      frontWindow: async () => current,
      every: (_ms, fn) => {
        tick = fn
        return () => {}
      },
    })
    await f.run()
    expect(shown.at(-1)?.marks[0]?.rect.y).toBe(160)

    // Scrolled up by 50 points: every line moved.
    const scrolled = page()
    scrolled.lines = scrolled.lines.map((l) =>
      l.box ? { ...l, box: { ...l.box, y: l.box.y - 50 } } : l,
    )
    current = scrolled
    tick()
    await new Promise((r) => setImmediate(r))
    expect(shown.at(-1)?.marks[0]?.rect.y).toBe(110)
    expect(shown.at(-1)?.marks[1]?.rect.y).toBe(200)

    current = { ...page(), windowId: 99 }
    tick()
    await new Promise((r) => setImmediate(r))
    expect(shown.at(-1)).toBeNull()
  })
})

describe('pageLines', () => {
  it('skips citation lines and starts near the first visible line', () => {
    const win = page()
    win.frame = { x: 0, y: 190, width: 800, height: 600 }
    win.lines.push({
      text: 'Smith, J. (2008). Egypt. ISBN 978-0-19-815034-3',
      conf: 1,
      box: { x: 100, y: 400, width: 500, height: 20 },
      align: 'left',
    })
    const lines = pageLines(win)
    expect(lines[0]?.text).toBe(TEXT[0])
    expect(lines.some((l) => l.text.includes('ISBN'))).toBe(false)
    expect(isCitation('^ Schneider, Thomas (27 August 2008). "Periodizing"')).toBe(true)
    expect(isCitation('Ramesses II ruled for 66 years.')).toBe(false)
  })
})
