import { describe, expect, it } from 'vitest'
import { makeEpisode, STUDY_TEXT } from '../testing/episodes'
import { prefilter } from './prefilter'
import { siteHints } from './site-hints'
import { academicDensity, isAcademicWord } from './vocabulary'

const CHATTER = [
  'Haha that was such a fun weekend, we went to the cottage and had a sauna.',
  'The weather was great and the dog loved swimming in the lake every morning.',
  'Next time we should bring more snacks and maybe a board game for the evening.',
].join('\n')

describe('vocabulary', () => {
  it('recognises academic words and stems in three languages', () => {
    expect(isAcademicWord('thermodynamics')).toBe(true)
    expect(isAcademicWord('Määritelmä')).toBe(true)
    expect(isAcademicWord('föreläsningen')).toBe(true)
    expect(isAcademicWord('example')).toBe(false)
    expect(isAcademicWord('general')).toBe(false)
    expect(academicDensity(STUDY_TEXT).density).toBeGreaterThan(0.08)
    expect(academicDensity(CHATTER).density).toBe(0)
  })
})

describe('siteHints', () => {
  it('knows study sites, reading apps and distractions', () => {
    const kinds = (bundle: string, url: string | null, title: string | null = null) =>
      siteHints(bundle, url, title).map((h) => h.kind)
    expect(
      kinds('com.google.Chrome', 'https://mycourses.aalto.fi/mod/assign/view.php?id=1'),
    ).toEqual(['lms'])
    expect(kinds('com.google.Chrome', 'https://moodle.helsinki.fi/course/view.php')).toEqual([
      'lms',
    ])
    expect(kinds('com.google.Chrome', 'https://canvas.instructure.com/courses/1')).toEqual(['lms'])
    expect(kinds('com.google.Chrome', 'https://arxiv.org/abs/2401.1')).toEqual(['paper'])
    expect(kinds('com.google.Chrome', 'https://fi.wikipedia.org/wiki/Osmoosi')).toEqual([
      'reference',
    ])
    expect(kinds('com.google.Chrome', 'https://docs.python.org/3/')).toEqual(['docs'])
    expect(kinds('com.apple.Preview', null, 'lecture4.pdf')).toEqual(['reading_app', 'pdf'])
    expect(kinds('com.spotify.client', null)).toEqual(['entertainment'])
    expect(kinds('com.google.Chrome', 'https://yle.fi/uutiset/3-123')).toEqual(['news'])
  })
})

describe('prefilter', () => {
  it('passes a study page read for a while', () => {
    const r = prefilter(makeEpisode())
    expect(r.pass).toBe(true)
    expect(r.score).toBeGreaterThan(0.7)
    expect(r.reasons.join(' ')).toContain('reference')
  })

  it('requires 20 s of dwell except for AI chats', () => {
    expect(prefilter(makeEpisode({ dwellSeconds: 12 })).pass).toBe(false)
    const chat = makeEpisode({
      kind: 'ai_chat',
      aiProvider: 'chatgpt',
      url: 'https://chatgpt.com/c/1',
      title: 'ChatGPT',
      dwellSeconds: 6,
      text: `[R] why is SN1 first order?\n[L] ${STUDY_TEXT}`,
    })
    expect(prefilter(chat).pass).toBe(true)
  })

  it('requires 150 characters of clean text', () => {
    const r = prefilter(makeEpisode({ text: '[L] Rate = k[R–X]' }))
    expect(r.pass).toBe(false)
    expect(r.cleanChars).toBeLessThan(150)
  })

  it('rejects music, news and small talk', () => {
    const spotify = makeEpisode({
      bundleId: 'com.spotify.client',
      app: 'Spotify',
      url: null,
      title: 'Spotify',
      text: `Daily Mix 1\nShuffle play\n${CHATTER}`,
    })
    expect(prefilter(spotify).pass).toBe(false)
    const news = makeEpisode({
      url: 'https://yle.fi/uutiset/3-1',
      title: 'Uutiset',
      text: CHATTER,
      signals: { ...makeEpisode().signals, scrollBacks: 0 },
    })
    expect(prefilter(news).pass).toBe(false)
    const blog = makeEpisode({
      url: 'https://someblog.example/weekend',
      title: 'Weekend',
      text: CHATTER,
    })
    expect(prefilter(blog).pass).toBe(false)
  })

  it('passes LMS pages with deadlines, PDFs and academic text on unknown sites', () => {
    const moodle = makeEpisode({
      url: 'https://mycourses.aalto.fi/mod/assign/view.php?id=7',
      title: 'Assignment 3: Linear regression',
      text: [
        'Assignment 3: Linear regression',
        'Due: Friday, 31 October 2026, 23:59',
        'Fit a linear regression model to the housing data and report the coefficients and residual plots.',
        'Submission status: No attempt',
      ].join('\n'),
      dwellSeconds: 25,
    })
    const r = prefilter(moodle)
    expect(r.pass).toBe(true)
    expect(r.reasons).toContain('deadline cue')
    const pdf = makeEpisode({
      bundleId: 'com.apple.Preview',
      app: 'Preview',
      url: null,
      title: 'lecture4.pdf',
      source: 'ocr',
    })
    expect(prefilter(pdf).pass).toBe(true)
    const unknown = makeEpisode({ url: 'https://someblog.example/sn1', title: 'Notes' })
    expect(prefilter(unknown).pass).toBe(true)
  })

  it('accepts overrides of the thresholds', () => {
    expect(prefilter(makeEpisode({ dwellSeconds: 12 }), { minDwellSeconds: 10 }).pass).toBe(true)
  })
})
