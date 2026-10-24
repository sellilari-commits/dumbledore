import type { Episode } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiChatTracker } from '../ai-chat/tracker'
import { batch, prose, win } from '../testing/frames'
import { EpisodeBuilder } from './builder'
import { pageKeyOf } from './keys'
import { StoredLines, storedLineKeys } from './stored-lines'
import { lineKey } from './text'

const T0 = Date.parse('2026-10-24T09:00:00.000Z')
const s = (seconds: number) => T0 + seconds * 1000
const URL = 'https://en.wikipedia.org/wiki/Tampere'
const TITLE = 'Tampere - Wikipedia'

const page = (lines: string[], changed = true) => win({ title: TITLE, url: URL, lines, changed })
const other = win({
  pid: 300,
  bundleId: 'com.spotify.client',
  appName: 'Spotify',
  windowId: 7,
  title: 'Spotify',
  url: null,
  lines: ['Daily Mix 1'],
})

const HEADING = 'History of Tampere'
const body = prose('Tampere', 1, 40)

describe('StoredLines', () => {
  it('keeps the most recently used pages only', () => {
    const stored = new StoredLines(2)
    stored.add('a', ['x'])
    stored.add('b', ['y'])
    stored.get('a')
    stored.add('c', ['z'])
    expect(stored.get('b')).toBeUndefined()
    expect([...(stored.get('a') ?? [])]).toEqual(['x'])
    expect(stored.size).toBe(2)
  })

  it('reads line keys from stored text, without alignment tags', () => {
    expect(storedLineKeys('[R] What is SN1?\n[L] A  Substitution\n\n')).toEqual([
      lineKey('What is SN1?'),
      lineKey('A Substitution'),
    ])
  })
})

describe('EpisodeBuilder: only new lines are stored', () => {
  let closed: Episode[]
  let stored: StoredLines
  let builder: EpisodeBuilder

  beforeEach(() => {
    closed = []
    stored = new StoredLines()
    const tracker = new AiChatTracker()
    builder = new EpisodeBuilder({
      classify: (w) => tracker.classify(w),
      redact: () => false,
      onClose: (e) => {
        if (e.url === URL) closed.push(e)
      },
      stored,
    })
  })

  /** Shows `lines` every 2 s from `from` to `to` (seconds). */
  const show = (from: number, to: number, lines: string[]) => {
    for (let t = from; t <= to; t += 2) builder.ingest(batch(s(t), page(lines, t === from)))
  }
  const leave = (at: number) => {
    builder.ingest(batch(s(at), other))
    builder.ingest(batch(s(at + 10), other))
  }
  const linesOf = (e: Episode | undefined) => (e?.text ?? '').split('\n')

  it('stores only the new lines after a small scroll across a checkpoint', () => {
    show(0, 180, [HEADING, ...body.slice(0, 10)]) // checkpoint at 180 s
    show(182, 200, [HEADING, ...body.slice(2, 12)]) // then scrolled 2 lines
    leave(202)
    expect(closed).toHaveLength(2)
    expect(linesOf(closed[0])).toEqual([HEADING, ...body.slice(0, 10)])
    expect(linesOf(closed[1])).toEqual([HEADING, ...body.slice(10, 12)])
    expect(closed[1]?.extracted).toBe(false)
  })

  it('stores only the new lines when the page is visited again', () => {
    show(0, 30, [HEADING, ...body.slice(0, 10)])
    leave(32)
    show(60, 90, [HEADING, ...body.slice(5, 15)])
    leave(92)
    expect(closed).toHaveLength(2)
    expect(linesOf(closed[1])).toEqual([HEADING, ...body.slice(10, 15)])
  })

  it('stores a revisit with nothing new as already extracted, with context only', () => {
    show(0, 30, [HEADING, ...body.slice(0, 10)])
    leave(32)
    show(60, 90, [HEADING, ...body.slice(0, 10)])
    leave(92)
    expect(closed).toHaveLength(2)
    expect(closed[1]?.extracted).toBe(true)
    expect(linesOf(closed[1])).toEqual([HEADING])
    expect(closed[1]?.dwellSeconds).toBeGreaterThan(20)
  })

  it('never drops highlighted text, and extracts a revisit that has a highlight', () => {
    show(0, 30, [HEADING, ...body.slice(0, 10)])
    leave(32)
    show(60, 70, [HEADING, ...body.slice(0, 10)])
    builder.addHighlight(body[4] as string)
    show(72, 90, [HEADING, ...body.slice(0, 10)])
    leave(92)
    expect(closed[1]?.extracted).toBe(false)
    expect(closed[1]?.signals.highlights).toEqual([body[4]])
    expect(linesOf(closed[1])).toContain(body[4])
  })

  it('uses lines seeded from stored episodes', () => {
    stored.seed([
      {
        pageKey: pageKeyOf({ bundleId: 'com.google.Chrome', url: URL, title: TITLE }),
        text: [HEADING, ...body.slice(0, 10)].join('\n'),
      },
    ])
    show(0, 30, [HEADING, ...body.slice(8, 14)])
    leave(32)
    expect(linesOf(closed[0])).toEqual([HEADING, ...body.slice(10, 14)])
  })
})
