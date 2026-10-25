import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { PerceivedWindow } from '@shared/helper-protocol'
import type { OutlineOverlay } from '@shared/state'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { drawMarks, isCitation, OutlineFlow, pageLines, pageText, union } from './outline-flow'

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
      sleep: async () => undefined,
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

  it('in an AI chat it outlines only the answers: the student’s right-aligned messages are left out', async () => {
    const chat = page()
    chat.lines[0] = {
      ...chat.lines[0],
      text: 'why are tertiary carbocations stable?',
      align: 'right',
    } as never
    await flow({ frontWindow: async () => chat, isAiChat: () => true }).run()
    expect(inputs[0]?.page.kind).toBe('ai_chat')
    expect(inputs[0]?.lines.map((l) => l.text)).not.toContain(
      'why are tertiary carbocations stable?',
    )
    await flow().run()
    expect(inputs[1]?.page.kind).toBe('page')
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

  it('remembers a page: holding again shows the same marks without asking again', async () => {
    const f = flow({ now: () => 1_000 })
    await f.run()
    f.clear()
    await f.run()
    expect(inputs).toHaveLength(1)
    expect(shown.at(-1)?.marks.map((m) => m.why)).toEqual(shown[0]?.marks.map((m) => m.why))
    expect(repos.notes.list({ subjectId })).toHaveLength(1) // the passage is saved once
  })

  it('reads again when the first read gives almost no text (Accessibility warming up)', async () => {
    let reads = 0
    const f = flow({
      frontWindow: async () => (++reads === 1 ? { ...page(), lines: [] } : page()),
    })
    expect((await f.run()).kind).toBe('shown')
    expect(reads).toBe(2)
  })

  it('reads a page whose text starts below the screen; marks wait for the scroll', async () => {
    const low = page()
    low.frame = { x: 0, y: 0, width: 800, height: 90 } // only the title fits on screen
    expect((await flow({ frontWindow: async () => low }).run()).kind).toBe('shown')
    expect(shown.at(-1)?.below).toBeGreaterThan(0)
  })

  it('says when the page can’t be read or has no subject', async () => {
    expect(await flow({ frontWindow: async () => null }).run()).toEqual({ kind: 'unreadable' })
    expect(await flow({ frontWindow: async () => 'private' }).run()).toEqual({ kind: 'private' })
    expect(await flow({ subjectFor: () => null }).run()).toEqual({ kind: 'noSubject' })
    expect(shown).toEqual([])
  })

  it('follows a scroll: the marks move with their text while any marked line is on screen', async () => {
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

    // Scrolled further: the first marked line left the view (Chrome squashes it onto the edge),
    // the rest of the passage is still on screen, so the marks stay and keep moving.
    const further = page()
    further.lines = further.lines.map((l, i) =>
      !l.box
        ? l
        : i === 2
          ? { ...l, box: { ...l.box, y: 0, height: 1 } }
          : { ...l, box: { ...l.box, y: l.box.y - 70 } },
    )
    current = further
    tick()
    await new Promise((r) => setImmediate(r))
    expect(shown.at(-1)?.marks[0]?.rect.y).toBe(90)

    // No marked line on screen any more: the marks clear.
    const gone = page()
    gone.lines = gone.lines.map((l) => (l.box ? { ...l, box: { ...l.box, y: 0, height: 0 } } : l))
    current = gone
    tick()
    await new Promise((r) => setImmediate(r))
    expect(shown.at(-1)).toBeNull()
  })

  it('clears the marks when another window comes to the front', async () => {
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
    current = { ...page(), windowId: 99 }
    tick()
    await new Promise((r) => setImmediate(r))
    expect(shown.at(-1)).toBeNull()
  })
})

describe('pageLines', () => {
  it('reads the whole page, marks only what is on screen, and counts the rest by direction', () => {
    const win = page()
    win.frame = { x: 0, y: 0, width: 800, height: 900 }
    // Chrome reports text below the window squeezed to its bottom edge with no height.
    const below = 'Stability: tertiary > secondary > primary.'
    win.lines.push({
      text: below,
      conf: 1,
      box: { x: 100, y: 900, width: 500, height: 0 },
      align: 'left',
    })
    expect(pageLines(win).map((l) => l.text)).not.toContain(below)
    expect(pageText(win, false).map((l) => l.text)).toContain(below)
    const drawn = drawMarks(
      [
        { verdict: 'read', why: 'On screen', order: 1, texts: [TEXT[1] ?? ''] },
        { verdict: 'read', why: 'Further down', order: 2, texts: [below] },
      ],
      win,
    )
    expect(drawn.marks.map((m) => m.why)).toEqual(['On screen'])
    expect(drawn).toMatchObject({ above: 0, below: 1, found: true })
    expect(
      drawMarks([{ verdict: 'read', why: 'x', order: 1, texts: ['not on this page'] }], win).found,
    ).toBe(false)
  })

  it('skips citation lines', () => {
    const win = page()
    win.frame = { x: 0, y: 0, width: 800, height: 900 }
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

  it('leaves out lines squashed onto the view’s edge (Chrome’s text scrolled out of view)', () => {
    const win = page()
    win.frame = { x: 0, y: 0, width: 800, height: 900 }
    win.lines.unshift({
      text: 'Everything above the view, merged into one line',
      conf: 1,
      box: { x: 100, y: 80, width: 500, height: 1 },
      align: 'left',
    })
    win.lines.push({
      text: 'A paragraph below the view',
      conf: 1,
      box: { x: 100, y: 900, width: 500, height: 0 },
      align: 'left',
    })
    const texts = pageLines(win).map((l) => l.text)
    expect(texts[0]).toBe(TEXT[0])
    expect(texts).not.toContain('A paragraph below the view')
    expect(texts).toHaveLength(TEXT.length)
  })
})
