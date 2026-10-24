import { describe, expect, it } from 'vitest'
import type { MergedLine } from './merged-text'
import {
  parseSearchQuery,
  ReadingBaseline,
  ScrollTracker,
  SearchLog,
  studentMessages,
  VisitLog,
} from './signals'

describe('parseSearchQuery', () => {
  it.each([
    [
      'https://www.google.com/search?q=sn1+vs+sn2+difference&oq=sn1',
      'google',
      'sn1 vs sn2 difference',
    ],
    ['https://www.google.fi/search?q=osmoosi', 'google', 'osmoosi'],
    ['https://www.bing.com/search?q=entropy%20definition', 'bing', 'entropy definition'],
    [
      'https://duckduckgo.com/?q=what+is+a+carbocation&ia=web',
      'duckduckgo',
      'what is a carbocation',
    ],
    ['https://scholar.google.com/scholar?q=hyperconjugation', 'google_scholar', 'hyperconjugation'],
    ['https://www.youtube.com/results?search_query=krebs+cycle', 'youtube', 'krebs cycle'],
  ])('reads %s', (url, engine, query) => {
    expect(parseSearchQuery(url)).toEqual({ engine, query })
  })

  it('ignores non-search pages', () => {
    expect(parseSearchQuery('https://mail.google.com/mail/u/0/?q=x')).toBeNull()
    expect(parseSearchQuery('https://www.google.com/maps?q=helsinki')).toBeNull()
    expect(parseSearchQuery('https://en.wikipedia.org/wiki/Entropy')).toBeNull()
    expect(parseSearchQuery(null)).toBeNull()
  })
})

describe('SearchLog', () => {
  it('returns distinct queries in a time window', () => {
    const log = new SearchLog()
    log.record('sn1', 1000)
    log.record('sn1', 2000)
    log.record('SN2', 3000)
    log.record('later', 90_000)
    expect(log.between(0, 10_000)).toEqual(['sn1', 'SN2'])
  })
})

describe('ReadingBaseline', () => {
  it('seeds from the median and moves slowly', () => {
    const b = new ReadingBaseline(0.5)
    expect(b.value).toBeNull()
    b.seed([100, 200, 300, 5000]) // 5000 wpm is implausible and dropped
    expect(b.value).toBe(200)
    b.update(100)
    expect(b.value).toBe(150)
    b.update(99999) // implausible, ignored
    expect(b.value).toBe(150)
  })
})

describe('VisitLog', () => {
  it('counts earlier visits of the same page on the same day', () => {
    const log = new VisitLog()
    const day = Date.parse('2026-10-24T09:00:00')
    expect(log.record('wiki/sn1', day)).toBe(0)
    expect(log.record('wiki/sn1', day + 1000)).toBe(1)
    expect(log.record('wiki/sn2', day + 2000)).toBe(0)
    expect(log.record('wiki/sn1', day + 24 * 3600 * 1000)).toBe(0)
  })
})

describe('ScrollTracker', () => {
  const doc = Array.from({ length: 40 }, (_, i) => `line ${i}`)
  const at = (k: string) => doc.indexOf(k)
  const view = (from: number) => ['nav', 'search', ...doc.slice(from, from + 8)]

  it('counts each run of backward scrolling once, ignoring sticky chrome', () => {
    const s = new ScrollTracker()
    s.observe(null, view(0), at)
    s.observe(view(0), view(4), at) // forward (shared lines moved up)
    s.observe(view(4), view(2), at) // back → 1
    s.observe(view(2), view(0), at) // still back
    s.observe(view(0), view(20), at) // jump forward (no shared lines)
    s.observe(view(20), view(5), at) // jump back → 2
    s.observe(view(5), view(4), at) // one-line jitter: ignored
    s.observe(view(4), ['nav', 'x'], at) // tiny frame: ignored
    expect(s.backs).toBe(2)
  })

  it('treats new lines appended at the bottom (a chat reply) as forward', () => {
    const s = new ScrollTracker()
    s.observe(view(0), [...view(0), 'reply 1', 'reply 2'], at)
    s.observe(view(10), view(1), at) // back → 1
    expect(s.backs).toBe(1)
  })
})

describe('studentMessages', () => {
  const line = (text: string, align: 'left' | 'right'): MergedLine => ({
    text,
    key: text,
    align,
    rank: 0,
    segment: 0,
  })

  it('groups consecutive right-aligned lines into messages', () => {
    const lines = [
      line('why are tertiary carbocations', 'right'),
      line('more stable?', 'right'),
      line('Because of hyperconjugation and induction.', 'left'),
      line('explain simpler', 'right'),
    ]
    expect(studentMessages(lines, 'right')).toEqual([
      'why are tertiary carbocations more stable?',
      'explain simpler',
    ])
    expect(studentMessages(lines, null)).toEqual([])
  })
})
