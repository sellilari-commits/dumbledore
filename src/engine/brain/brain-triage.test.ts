import type { ExtractInput, TriageInput } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { buildTriageUser, finalizeTriage } from './prompts/p00-triage'
import { buildExtractUser, conceptRefs, finalizeExtract } from './prompts/p01-extract'
import { brainHarness } from './testing/harness'

const signals = {
  readingWpm: null,
  baselineWpm: null,
  scrollBacks: 0,
  revisitsToday: 0,
  searches: [],
  aiQuestions: [],
  highlights: [],
}
const entry = (id: string, over: Partial<TriageInput['episodes'][number]> = {}) => ({
  id,
  kind: 'reading' as const,
  app: 'Google Chrome',
  title: 'Tampere - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Tampere',
  dwellSeconds: 75,
  signals,
  excerpt: 'Tampere is a city in Finland, founded in 1779 by King Gustav III.',
  ...over,
})
const window = (episodes: TriageInput['episodes']): TriageInput => ({ language: 'en', episodes })

describe('P0 triage', () => {
  it('lists the window as numbered entries with signals, excerpt and highlights', () => {
    const user = buildTriageUser(
      window([
        entry('e1', {
          kind: 'other',
          title: 'tampere history - Google Search',
          url: 'https://www.google.com/search?q=tampere+history',
          dwellSeconds: 8,
          signals: { ...signals, searches: ['tampere history'] },
          excerpt: 'Results  for tampere history',
        }),
        entry('e2', {
          signals: { ...signals, highlights: ['founded in 1779'] },
        }),
      ]),
    )
    expect(user).toBe(
      [
        '1. id=e1 · other · Google Chrome · "tampere history - Google Search" · www.google.com/search · 8s · searches=["tampere history"]',
        '   excerpt: Results for tampere history',
        '2. id=e2 · reading · Google Chrome · "Tampere - Wikipedia" · en.wikipedia.org/wiki/Tampere · 1m15s',
        '   excerpt: Tampere is a city in Finland, founded in 1779 by King Gustav III.',
        '   highlighted: "founded in 1779"',
      ].join('\n'),
    )
  })

  it('answers every episode by id; missing or unknown answers are null', () => {
    const input = window([entry('e1'), entry('e2'), entry('e3')])
    const out = finalizeTriage(
      {
        results: [
          { id: ' e2 ', hasLearnableContent: false, reason: ' feed ' },
          { id: 'e1', hasLearnableContent: true, reason: 'history' },
          { id: 'zz', hasLearnableContent: true, reason: 'unknown id' },
        ],
      },
      input,
    )
    expect(out.results).toEqual([
      { id: 'e1', hasLearnableContent: true, reason: 'history' },
      { id: 'e2', hasLearnableContent: false, reason: 'feed' },
      { id: 'e3', hasLearnableContent: true, reason: 'unknown id' },
    ])
    expect(
      finalizeTriage({ results: [] }, input).results.map((r) => r.hasLearnableContent),
    ).toEqual([null, null, null])
  })

  it('runs on the triage tier with the learnable-content definition', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: { results: [{ id: 'e1', hasLearnableContent: true, reason: 'history facts' }] },
    })
    const out = await h.brain.triage(window([entry('e1')]))
    expect(out.results).toEqual([{ id: 'e1', hasLearnableContent: true, reason: 'history facts' }])
    expect(h.groq.requests[0]?.system).toContain('LEARNABLE CONTENT')
    expect(h.groq.requests[0]?.system).toContain('Judge the episodes together')
    expect(await h.brain.triage(window([]))).toEqual({ results: [] })
  })
})

describe('P1 window context and concept refs', () => {
  const input: ExtractInput = {
    student: { aboutMe: '', language: 'en' },
    subjects: [
      {
        id: 'sub_h',
        name: 'History',
        topConcepts: [],
        concepts: [
          { id: 'con_fi', name: 'Finland', parentId: null },
          { id: 'con_tre', name: 'Tampere', parentId: 'con_fi' },
        ],
      },
    ],
    episodes: [
      {
        id: 'e1',
        app: 'Google Chrome',
        url: null,
        title: 'Tampere - Wikipedia',
        kind: 'reading',
        aiProvider: null,
        dwellSeconds: 90,
        signals,
        text: 'Tampere was founded in 1779.',
      },
    ],
    context: ['tampere history - Google Search (reading)', 'ChatGPT (AI chat)'],
  }

  it('lists the tree with short refs and the window as <context>', () => {
    const user = buildExtractUser(input, '2026-10-24 (Saturday)')
    expect(user).toContain('- id=sub_h · History\n  c1 Finland\n  c2 Tampere < c1')
    expect(user).toContain(
      '<context>\ntampere history - Google Search (reading) · ChatGPT (AI chat)\n</context>',
    )
    expect(conceptRefs(input).toId.get('c2')).toBe('con_tre')
  })

  it("maps the model's refs back to ids and passes unknown ones through", () => {
    const out = finalizeExtract(
      {
        results: [
          {
            episodeId: 'e1',
            reason: 'history',
            isLearning: true,
            confidence: 0.9,
            items: [
              {
                topicPath: ['History', 'Tampere'],
                seen: 'Tampere was founded in 1779.',
                bigPicture: 'Local history.',
                evidence: '',
                understanding: 'unknown',
                openQuestions: [],
                keyTerms: ['Tampere'],
                subjectMatchId: 'sub_h',
                subjectNewName: null,
                assignment: null,
                notes: [
                  {
                    text: ' Founded in 1779 ',
                    keywords: ['1779', ''],
                    conceptId: 'c2',
                    newConcept: null,
                  },
                  {
                    text: 'Finlayson built a cotton mill',
                    keywords: ['Finlayson'],
                    conceptId: null,
                    newConcept: { name: 'Industry', parentId: 'c2' },
                  },
                  { text: 'x', keywords: [], conceptId: 'c42', newConcept: null },
                  { text: '  ', keywords: [], conceptId: null, newConcept: null },
                ],
              },
            ],
            studentPrompts: [],
          },
        ],
      },
      input,
    )
    expect(out.results[0]?.items[0]?.notes).toEqual([
      { text: 'Founded in 1779', keywords: ['1779'], conceptId: 'con_tre', newConcept: null },
      {
        text: 'Finlayson built a cotton mill',
        keywords: ['Finlayson'],
        conceptId: null,
        newConcept: { name: 'Industry', parentId: 'con_tre' },
      },
      { text: 'x', keywords: [], conceptId: 'c42', newConcept: null },
    ])
  })
})
