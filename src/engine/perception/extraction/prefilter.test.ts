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

  it("never sends Dumbledore's own screens read back from a preview window", () => {
    const preview = makeEpisode({
      bundleId: 'com.anthropic.claudefordesktop',
      app: 'Claude',
      title: 'Claude',
      url: null,
      kind: 'ai_chat',
      aiProvider: 'claude',
      text: [
        '[L] Ran a command, read 2 files',
        '[L] Dumbledore',
        '[R] Search ⌘K',
        '[R] Inbox 6',
        '[R] Exams',
        '[R] Settings',
        '[L] Subjects',
        '[L] 🧪 Organic Chemistry Focus',
        '[R] Lab report: SN1 hydrolysis',
        '[R] in 10 days',
        STUDY_TEXT,
      ].join('\n'),
    })
    const r = prefilter(preview)
    expect(r.pass).toBe(false)
    expect(r.reasons).toContain('dumbledore ui')
    const mockChat = makeEpisode({
      url: 'http://127.0.0.1:5199/',
      title: 'ChatGPT (mock) — Dumbledore test page',
      text: `Organic chemistry: SN1 vs SN2\nMock chat for Dumbledore tests. Nothing leaves this computer.\n${STUDY_TEXT}`,
    })
    expect(prefilter(mockChat).reasons).toContain('dumbledore ui')
  })

  it("drops an AI chat's empty start page but keeps typed prompts and conversations", () => {
    const home = (text: string, url = 'https://chatgpt.com/') =>
      makeEpisode({ kind: 'ai_chat', aiProvider: 'chatgpt', title: 'ChatGPT', url, text })
    const empty = [
      '[L] Images',
      '[L] Get responses tailored to you',
      '[L] Log in to get answers based on saved chats, plus create images and upload files.',
      '[C] Where should we begin?',
      '[L] ChatGPT is AI. By using it, you agree to ourTerms&Privacy Policy. Chats may be reviewed and used to improve our AI models.Learn more',
      '[L] Cookies help this site function, measure usage, and support marketing.Manage',
    ].join('\n')
    const r = prefilter(home(empty))
    expect(r.pass).toBe(false)
    expect(r.reasons).toContain('empty chat page')
    const fi = [
      '[L] Uusi keskustelu',
      '[L] Kirjaudu sisään saadaksesi vastauksia tallennettujen keskustelujen perusteella sekä luodaksesi kuvia.',
      '[R] Mistä aloitetaan?',
      '[R] ChatGPT on tekoäly. Kun käytät sitä, hyväksyt käyttöehdot ja tietosuojakäytännön.',
      '[C] Keskustelu ChatGPT:n kanssa',
    ].join('\n')
    expect(prefilter(home(fi, 'https://gemini.google.com/app?hl=fi')).reasons).toContain(
      'empty chat page',
    )
    const typed = `${empty}\n[L] I am new to organic chemistry and trying to understand SN1 vs SN2. Short bullets, bold key terms, then quiz me.`
    expect(prefilter(home(typed)).pass).toBe(true)
    expect(prefilter(home(empty, 'https://chatgpt.com/c/6adcecef-5cf4')).reasons).not.toContain(
      'empty chat page',
    )
  })
})
