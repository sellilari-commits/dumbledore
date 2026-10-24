import type { Episode } from '@shared/domain'
import type { NowContext } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { AiChatTracker } from '../ai-chat/tracker'
import { ONE_SEGMENT_PER_VISIT } from '../testing/episodes'
import { batch, prose, win } from '../testing/frames'
import { EpisodeBuilder } from './builder'
import { chatExcerptOf, pageContextOf } from './context'

const T0 = Date.parse('2026-10-24T09:00:00.000Z')
const s = (seconds: number) => T0 + seconds * 1000

const wiki = (lines: string[], extra: Parameters<typeof win>[0] = {}) =>
  win({
    title: 'SN1 reaction - Wikipedia',
    url: 'https://en.wikipedia.org/wiki/SN1_reaction',
    lines,
    ...extra,
  })
const spotify = win({
  pid: 300,
  bundleId: 'com.spotify.client',
  appName: 'Spotify',
  windowId: 7,
  title: 'Spotify Premium',
  url: null,
  lines: ['Daily Mix 1', 'Shuffle play'],
})

describe('EpisodeBuilder', () => {
  let closed: Episode[]
  let nows: (NowContext | null)[]
  let mask: boolean
  let builder: EpisodeBuilder
  let frames: number

  beforeEach(() => {
    closed = []
    nows = []
    mask = true
    frames = 0
    const tracker = new AiChatTracker()
    builder = new EpisodeBuilder({
      classify: (w) => tracker.classify(w),
      redact: () => mask,
      onClose: (e) => closed.push(e),
      onNow: (n) => nows.push(n),
      onFrame: () => frames++,
      subjectFor: (page) => (page.includes('SN1') ? 'sub_chem' : null),
      options: ONE_SEGMENT_PER_VISIT,
    })
  })

  /** Feeds the same window every 2 s from `from` to `to` (seconds), changing lines per step. */
  const read = (from: number, to: number, linesAt: (t: number) => string[] | null, extra = {}) => {
    for (let t = from; t <= to; t += 2) {
      const lines = linesAt(t)
      builder.ingest(batch(s(t), wiki(lines ?? [], { changed: lines !== null, ...extra })))
    }
  }

  it('builds one reading episode from scrolled frames, with dwell and scroll-backs', () => {
    const page = prose('SN1', 1, 40)
    read(0, 60, (t) => {
      if (t % 10 !== 0) return null // unchanged frames in between
      const top = t <= 30 ? t / 2 : 30 - (t - 30) // down, then back up
      return page.slice(top, top + 10)
    })
    builder.ingest(batch(s(62), spotify))
    builder.ingest(batch(s(70), spotify))
    expect(closed).toHaveLength(1)
    const ep = closed[0] as Episode
    expect(ep.kind).toBe('reading')
    expect(ep.source).toBe('ax')
    expect(ep.dwellSeconds).toBe(60)
    expect(ep.endedAt).toBe(new Date(s(62)).toISOString())
    expect(ep.signals.scrollBacks).toBe(1)
    const lines = ep.text.split('\n')
    expect(new Set(lines).size).toBe(lines.length)
    expect(lines[0]).toBe(page[0])
    expect(ep.signals.readingWpm).toBeGreaterThan(0)
    expect(ep.signals.baselineWpm).toBeNull() // first reading episode
    expect(frames).toBeGreaterThan(0)
  })

  it('keeps the episode open across a switch shorter than 8 s and drops tiny episodes', () => {
    read(0, 20, (t) => (t === 0 ? prose('A', 1, 12) : null))
    builder.ingest(batch(s(22), spotify))
    builder.ingest(batch(s(24), spotify))
    read(26, 40, () => null)
    builder.ingest(batch(s(42), null)) // nothing readable in front
    builder.ingest(batch(s(51), null))
    expect(closed).toHaveLength(1)
    expect(closed[0]?.dwellSeconds).toBe(34) // 0–20 and 26–40, not the time away
  })

  it('cuts long reads into 3-minute checkpoints that continue the same page', () => {
    const page = prose('Long', 1, 200)
    read(0, 400, (t) => (t % 20 === 0 ? page.slice(t / 4, t / 4 + 10) : null))
    builder.closeAll()
    expect(closed.length).toBe(3)
    const [a, b, c] = closed as [Episode, Episode, Episode]
    expect(new Set([a.id, b.id, c.id]).size).toBe(3)
    expect(a.dwellSeconds).toBe(180)
    expect(b.startedAt).toBe(a.endedAt)
    // the second segment starts with what was on screen at the checkpoint, not page 1
    expect(b.text.split('\n')[0]).toBe(page[45])
    expect(b.text).not.toContain(page[0])
    expect(b.signals.revisitsToday).toBe(0)
  })

  it('records an AI chat with roles, the student questions and no chat chrome', () => {
    const chat = (
      lines: ([string, 'left' | 'right'] | string)[],
      url = 'https://chatgpt.com/c/abc',
    ) => win({ title: 'ChatGPT', url, lines })
    builder.ingest(batch(s(0), chat(['Ask anything'], 'https://chatgpt.com/')))
    builder.ingest(
      batch(
        s(2),
        chat([
          ['why are tertiary carbocations more stable', 'right'],
          'Tertiary carbocations are stabilised by hyperconjugation.',
          'Ask anything',
          'ChatGPT can make mistakes. Check important info.',
        ]),
      ),
    )
    builder.ingest(
      batch(
        s(4),
        chat([
          ['explain it simpler, my email is a@b.fi', 'right'],
          'Think of neighbours sharing load.',
        ]),
      ),
    )
    builder.ingest(batch(s(30), chat([], 'https://chatgpt.com/c/abc')))
    builder.closeAll()
    expect(closed).toHaveLength(1) // new chat → conversation stayed one episode
    const ep = closed[0] as Episode
    expect(ep.kind).toBe('ai_chat')
    expect(ep.aiProvider).toBe('chatgpt')
    expect(ep.signals.aiQuestions).toEqual([
      'why are tertiary carbocations more stable',
      'explain it simpler, my email is [email]',
    ])
    expect(ep.text).toContain('[R] why are tertiary carbocations more stable')
    expect(ep.text).toContain('[L] Tertiary carbocations are stabilised by hyperconjugation.')
    expect(ep.text).not.toContain('Ask anything')
    expect(ep.text).not.toContain('can make mistakes')
    expect(ep.text).not.toContain('a@b.fi')
  })

  it('attaches recent searches and counts revisits', () => {
    builder.ingest(
      batch(
        s(0),
        win({
          title: 'sn1 - Google',
          url: 'https://www.google.com/search?q=sn1+mechanism',
          lines: ['results'],
        }),
      ),
    )
    read(2, 30, (t) => (t === 2 ? prose('SN1', 1, 10) : null))
    builder.ingest(batch(s(32), spotify))
    builder.ingest(batch(s(41), spotify))
    read(60, 80, (t) => (t === 60 ? prose('SN1', 1, 10) : null))
    builder.closeAll()
    const visits = closed.filter((e) => e.url?.includes('wikipedia'))
    expect(visits).toHaveLength(2)
    expect(visits[0]?.signals.searches).toEqual(['sn1 mechanism'])
    expect(visits[0]?.signals.revisitsToday).toBe(0)
    expect(visits[1]?.signals.revisitsToday).toBe(1)
  })

  it('masks secrets at capture unless redaction is switched off', () => {
    read(0, 10, (t) => (t === 0 ? ['Contact maija@uni.fi', ...prose('X', 1, 5)] : null))
    builder.closeAll()
    expect(closed[0]?.text).toContain('Contact [email]')
    mask = false
    read(100, 110, (t) => (t === 100 ? ['Contact maija@uni.fi', ...prose('Y', 1, 5)] : null), {
      url: 'https://example.org/b',
    })
    builder.closeAll()
    expect(closed[1]?.text).toContain('maija@uni.fi')
  })

  it('stops counting dwell while the student is away from the keyboard', () => {
    for (let t = 0; t <= 60; t += 10) {
      builder.ingest(
        batch(s(t), wiki(t === 0 ? prose('Z', 1, 10) : [], { changed: t === 0 }), null, 150),
      )
    }
    builder.closeAll()
    expect(closed).toHaveLength(0) // no dwell → nothing worth keeping
  })

  it('tracks side-by-side windows only while their content changes', () => {
    const pdf = (lines: string[]) =>
      win({
        pid: 200,
        bundleId: 'com.apple.Preview',
        appName: 'Preview',
        windowId: 3,
        title: 'lecture4.pdf',
        url: null,
        source: 'ocr',
        lines,
      })
    const chatFront = win({
      title: 'ChatGPT',
      url: 'https://chatgpt.com/c/1',
      lines: [['hi', 'right']],
    })
    const slides = prose('Entropy', 1, 30)
    builder.ingest(batch(s(0), chatFront, [pdf(slides.slice(0, 10))]))
    for (let t = 6; t <= 60; t += 6) {
      const front = win({ title: 'ChatGPT', url: 'https://chatgpt.com/c/1', changed: false })
      builder.ingest(batch(s(t), front, [t <= 30 ? pdf(slides.slice(t / 3, t / 3 + 10)) : pdf([])]))
    }
    builder.closeAll()
    const pdfEp = closed.find((e) => e.bundleId === 'com.apple.Preview')
    expect(pdfEp?.kind).toBe('reading')
    expect(pdfEp?.source).toBe('ocr')
    expect(pdfEp?.dwellSeconds).toBe(30)
  })

  it('reports Right now and clears it when nothing readable is in front', () => {
    read(0, 130, (t) => (t === 0 ? prose('SN1', 1, 20) : null))
    expect(nows[0]).toMatchObject({
      app: 'Google Chrome',
      kind: 'reading',
      minutes: 0,
      subjectId: 'sub_chem',
    })
    expect(nows.at(-1)?.minutes).toBe(2)
    builder.ingest(batch(s(132), null))
    expect(nows.at(-1)).toBeNull()
  })

  it('serves a chat excerpt with roles and the page around the viewport', () => {
    builder.ingest(
      batch(
        s(0),
        win({
          title: 'ChatGPT',
          url: 'https://chatgpt.com/c/9',
          lines: [
            ['what is entropy', 'right'],
            'Entropy measures disorder.',
            'It always grows in isolated systems.',
          ],
        }),
      ),
    )
    const chat = builder.chatSource()
    expect(chatExcerptOf(chat, builder.env, 'ChatGPT', 500)).toBe(
      'Student: what is entropy\n\nChatGPT: Entropy measures disorder.\nIt always grows in isolated systems.',
    )
    const short = chatExcerptOf(chat, builder.env, 'ChatGPT', 60)
    expect(short.length).toBeLessThanOrEqual(60)
    expect(short.startsWith('…')).toBe(true)
    expect(short.endsWith('It always grows in isolated systems.')).toBe(true)
    const page = prose('P', 1, 30)
    builder.ingest(batch(s(2), wiki(page.slice(0, 10))))
    builder.ingest(batch(s(4), wiki(page.slice(10, 20))))
    const ctx = pageContextOf(builder.pageSource(), builder.env, 400)
    expect(
      ctx.startsWith('SN1 reaction - Wikipedia — https://en.wikipedia.org/wiki/SN1_reaction'),
    ).toBe(true)
    expect(ctx).toContain(page[10])
    expect(ctx.length).toBeLessThanOrEqual(400)
    // the chat stays readable after its episode closed
    builder.ingest(batch(s(30), wiki([], { changed: false })))
    expect(chatExcerptOf(builder.chatSource(), builder.env, 'ChatGPT', 500)).toContain(
      'Student: what is entropy',
    )
  })
})
