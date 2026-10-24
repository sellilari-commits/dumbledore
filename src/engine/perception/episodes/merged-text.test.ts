import { describe, expect, it } from 'vitest'
import { BoilerplateStripper } from './boilerplate'
import { type FrameLine, MergedText } from './merged-text'
import { cleanLine, isUiNoise, lineKey, wordCount } from './text'

const f = (...texts: string[]): FrameLine[] => texts.map((text) => ({ text, align: 'left' }))
const texts = (m: MergedText) => m.all().map((l) => l.text)

describe('MergedText', () => {
  it('merges frames scrolled downwards without duplicating lines', () => {
    const m = new MergedText()
    m.addFrame(f('a', 'b', 'c', 'd'), 0)
    const r = m.addFrame(f('c', 'd', 'e', 'f'), 0)
    expect(texts(m)).toEqual(['a', 'b', 'c', 'd', 'e', 'f'])
    expect(r.added.map((l) => l.text)).toEqual(['e', 'f'])
    expect(r.topIndex).toBe(2)
  })

  it('puts lines revealed above the known text before it', () => {
    const m = new MergedText()
    m.addFrame(f('c', 'd', 'e'), 0)
    const r = m.addFrame(f('a', 'b', 'c'), 0)
    expect(texts(m)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(r.topIndex).toBe(0)
  })

  it('fills gaps between known lines in order', () => {
    const m = new MergedText()
    m.addFrame(f('a', 'b', 'e'), 0)
    m.addFrame(f('b', 'c', 'd', 'e'), 0)
    expect(texts(m)).toEqual(['a', 'b', 'c', 'd', 'e'])
  })

  it('appends frames with no overlap (a jump) and dedupes inside a frame', () => {
    const m = new MergedText()
    m.addFrame(f('a', 'b'), 0)
    m.addFrame(f('x', 'y', 'x'), 0)
    expect(texts(m)).toEqual(['a', 'b', 'x', 'y'])
  })

  it('treats dash and spacing variants of a line as the same line', () => {
    const m = new MergedText()
    m.addFrame(f('Rate = k[R–X]', 'next line'), 0)
    m.addFrame(f('Rate  =  k[R-X]', 'next line', 'third'), 0)
    expect(m.size).toBe(3)
  })

  it('keeps order after many inserts between the same two lines', () => {
    const m = new MergedText()
    m.addFrame(f('start', 'end'), 0)
    let prev = 'start'
    for (let i = 0; i < 80; i++) {
      m.addFrame(f(prev, `mid ${i}`, 'end'), 0)
      prev = `mid ${i}`
    }
    const all = texts(m)
    expect(all[0]).toBe('start')
    expect(all.at(-1)).toBe('end')
    expect(all.slice(1, -1)).toEqual(Array.from({ length: 80 }, (_, i) => `mid ${i}`))
  })

  it('tracks the segment each line was last seen in', () => {
    const m = new MergedText()
    m.addFrame(f('a', 'b'), 0)
    m.addFrame(f('b', 'c'), 1)
    expect(m.all().map((l) => l.segment)).toEqual([0, 1, 1])
    m.touch(['a'], 2)
    expect(m.get('a')?.segment).toBe(2)
  })

  it('continues a page turn behind a fixed title line after the page that was on screen', () => {
    const m = new MergedText()
    m.addFrame(f('Lecture.pdf', 'slide 1 a', 'slide 1 b'), 0)
    m.addFrame(f('Lecture.pdf', 'slide 2 a', 'slide 2 b', 'slide 2 c'), 0)
    m.addFrame(f('Lecture.pdf', 'slide 3 a', 'slide 3 b'), 0)
    m.addFrame(f('Lecture.pdf', 'slide 2 a', 'slide 2 b', 'slide 2 c'), 0) // flip back: nothing new
    expect(texts(m)).toEqual([
      'Lecture.pdf',
      'slide 1 a',
      'slide 1 b',
      'slide 2 a',
      'slide 2 b',
      'slide 2 c',
      'slide 3 a',
      'slide 3 b',
    ])
    expect(m.firstSeen('slide 3 a')).toBeGreaterThan(m.firstSeen('slide 2 c') ?? Infinity)
    expect(m.firstSeen('nope')).toBeNull()
  })

  it('keeps a reply between a fixed header and an input bar in place', () => {
    const m = new MergedText()
    m.addFrame(f('New chat', 'What can I help with?', 'Ask anything'), 0)
    m.addFrame(f('New chat', 'question', 'answer', 'Ask anything'), 0)
    expect(texts(m)).toEqual([
      'New chat',
      'What can I help with?',
      'question',
      'answer',
      'Ask anything',
    ])
  })
})

describe('text helpers', () => {
  it('cleans OCR lines and builds keys', () => {
    expect(cleanLine('  Ăland   islands ', true)).toBe('Åland islands')
    expect(lineKey('“Quoted” — Text…')).toBe('"quoted" - text...')
  })

  it('spots UI noise and counts words', () => {
    expect(isUiNoise('Accept all cookies')).toBe(true)
    expect(isUiNoise('•')).toBe(true)
    expect(isUiNoise('→ ← ↑')).toBe(true)
    expect(isUiNoise('2 + 2 = 4')).toBe(false)
    expect(wordCount("The cell's membrane is semi-permeable.")).toBe(5)
  })
})

describe('BoilerplateStripper', () => {
  const scopes = ['app:com.google.Chrome']
  const keys = (...k: string[]) => new Set(k)

  it('needs three different pages before stripping anything', () => {
    const b = new BoilerplateStripper()
    for (let i = 0; i < 20; i++) b.observe(scopes, 'page-a', keys('nav', `line ${i}`))
    expect(b.isBoilerplate(scopes, 'nav')).toBe(false)
  })

  it('strips lines that appear on ≥ 80% of recent pages, never page content', () => {
    const b = new BoilerplateStripper()
    for (let i = 0; i < 15; i++) b.observe(scopes, 'page-a', keys('nav', 'footer', `a ${i}`))
    b.observe(scopes, 'page-b', keys('nav', 'footer', 'b 1'))
    b.observe(scopes, 'page-c', keys('nav', 'c 1'))
    b.observe(scopes, 'page-d', keys('nav', 'footer', 'd 1'))
    b.observe(scopes, 'page-e', keys('nav', 'footer', 'e 1'))
    expect(b.isBoilerplate(scopes, 'nav')).toBe(true)
    expect(b.isBoilerplate(scopes, 'footer')).toBe(true) // 4 of 5 pages
    expect(b.isBoilerplate(scopes, 'a 3')).toBe(false)
    expect(b.isBoilerplate(['app:other'], 'nav')).toBe(false)
  })
})
