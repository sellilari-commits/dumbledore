import type { ExtractInput } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { groupEpisodes } from './brain'
import { buildExtractUser, finalizeExtract, type LlmExtract } from './prompts/p01-extract'
import { brainHarness, R } from './testing/harness'

const signals = {
  readingWpm: 84,
  baselineWpm: 210,
  scrollBacks: 3,
  revisitsToday: 2,
  searches: ['sn1 vs sn2 difference'],
  aiQuestions: [],
  highlights: [],
}
const episode = (id: string, over: Partial<ExtractInput['episodes'][number]> = {}) => ({
  id,
  app: 'Google Chrome',
  url: 'https://en.wikipedia.org/wiki/SN1_reaction',
  title: 'SN1 reaction - Wikipedia',
  kind: 'reading' as const,
  aiProvider: null,
  dwellSeconds: 412,
  signals,
  text: '[L] The SN1 reaction is a substitution reaction. Rate = k[R–X].',
  ...over,
})
const input = (episodes: ExtractInput['episodes']): ExtractInput => ({
  student: { aboutMe: 'First-year chemistry student', language: 'en' },
  subjects: [{ id: 's1', name: 'Organic Chemistry', topConcepts: ['SN2', 'nucleophiles'] }],
  episodes,
})
const item = (over: Record<string, unknown> = {}) => ({
  topicPath: ['Organic Chemistry', 'Nucleophilic substitution', 'SN1'],
  seen: 'SN1 rate depends only on the substrate: rate = k[R–X].',
  bigPicture: 'Working out when SN1 happens, for the midterm.',
  evidence: 'Read at 84 wpm vs 210 usual; scrolled back 3 times.',
  understanding: 'struggling',
  openQuestions: ['Why are tertiary carbocations more stable?'],
  keyTerms: ['SN1', 'carbocation'],
  subjectMatchId: 's1',
  subjectNewName: null,
  assignment: null,
  ...over,
})
const result = (episodeId: string, over: Record<string, unknown> = {}) => ({
  episodeId,
  reason: 'Studying SN1',
  isLearning: true,
  confidence: 0.9,
  items: [item()],
  studentPrompts: [],
  ...over,
})

describe('Brain.extract', () => {
  it('builds tagged episodes with signals, subjects and today', async () => {
    const h = brainHarness()
    h.groq.queue({ json: { results: [result('e1')] } })
    const out = await h.brain.extract(input([episode('e1')]))
    const user = h.userOf(h.groq)
    expect(user).toContain('<today>\n2026-10-24 (Saturday)')
    expect(user).toContain('id=s1 · Organic Chemistry · concepts: SN2, nucleophiles')
    expect(user).toContain('<episode id="e1" kind="reading" app="Google Chrome"')
    expect(user).toContain('dwell="6m52s"')
    expect(user).toContain(
      'reading=slow (84 wpm vs 210 usual) · scrolled_back=3 · revisits_today=2',
    )
    expect(h.groq.requests[0]?.system).toContain('Example output')
    expect(out.results[0]).toMatchObject({
      episodeId: 'e1',
      isLearning: true,
      items: [
        { subject: { matchId: 's1', newName: null }, understanding: { status: 'struggling' } },
      ],
    })
  })

  it('never reports struggling without evidence, and fixes unknown subject ids', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        results: [
          result('e1', {
            items: [
              item({
                evidence: '',
                subjectMatchId: 'nope',
                subjectNewName: null,
                topicPath: ['Chem', 'A', 'B', 'C', 'D'],
              }),
            ],
          }),
        ],
      },
    })
    const out = await h.brain.extract(input([episode('e1')]))
    const it0 = out.results[0]?.items[0]
    expect(it0?.understanding.status).toBe('unknown')
    expect(it0?.subject).toEqual({ matchId: null, newName: 'Chem' })
    expect(it0?.topicPath).toHaveLength(4)
  })

  it('keeps student prompts for AI chats only and drops items of non-learning episodes', async () => {
    const h = brainHarness()
    const prompt = {
      text: 'explain sn1',
      hasContext: false,
      hasStructure: false,
      asksToBeQuizzed: false,
      asksForExamples: false,
    }
    h.groq.queue({
      json: {
        results: [
          result('chat', { studentPrompts: [prompt] }),
          result('read', { studentPrompts: [prompt] }),
          result('ig', { isLearning: false, items: [item()] }),
        ],
      },
    })
    const out = await h.brain.extract(
      input([
        episode('chat', { kind: 'ai_chat', aiProvider: 'chatgpt' }),
        episode('read'),
        episode('ig', { app: 'Instagram' }),
      ]),
    )
    expect(out.results.map((r) => r.studentPrompts.length)).toEqual([1, 0, 0])
    expect(out.results[2]?.items).toEqual([])
  })

  it('fills a result for every episode even when the model skips one', async () => {
    const h = brainHarness()
    h.groq.fallback = { json: { results: [result('e1')] } }
    const out = await h.brain.extract(input([episode('e1'), episode('e2')]))
    expect(out.results.map((r) => r.episodeId)).toEqual(['e1', 'e2'])
    expect(out.results[1]?.isLearning).toBe(false)
  })

  it('validates assignment dates', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        results: [
          result('e1', {
            items: [
              item({
                assignment: { title: 'Problem set 3', course: 'CHEM-A1250', dueAt: '2026-10-30' },
              }),
              item({ assignment: { title: 'Essay', course: null, dueAt: 'next Friday' } }),
            ],
          }),
        ],
      },
    })
    const out = await h.brain.extract(input([episode('e1')]))
    expect(out.results[0]?.items.map((i) => i.assignment?.dueAt)).toEqual(['2026-10-30', null])
  })

  it('runs one compact on-device call per episode when Apple goes first', async () => {
    const h = brainHarness([R.apple, R.ovh])
    h.apple.fallback = (req) => {
      const id = /<episode id="([^"]+)"/.exec(req.messages[0]?.content ?? '')?.[1] ?? '?'
      return { json: { results: [result(id)] } }
    }
    const out = await h.brain.extract(input([episode('e1'), episode('e2')]))
    expect(h.apple.requests).toHaveLength(2)
    expect(h.apple.requests[0]?.system).not.toContain('Example output')
    expect(out.results.map((r) => r.episodeId)).toEqual(['e1', 'e2'])
  })

  it('sends Finnish content to the cloud, batched', async () => {
    const h = brainHarness([R.apple, R.ovh])
    h.ovh.fallback = { json: { results: [result('f1'), result('f2')] } }
    const fi =
      '[L] Fotosynteesi on prosessi, jossa kasvit muuttavat valoenergiaa kemialliseksi energiaksi. En ymmärrä miten se toimii.'
    await h.brain.extract(input([episode('f1', { text: fi }), episode('f2', { text: fi })]))
    expect(h.apple.requests).toHaveLength(0)
    expect(h.ovh.requests).toHaveLength(1)
  })

  it('groups episodes: ≤ 3 per cloud call, long text clipped', () => {
    const many = input(
      Array.from({ length: 7 }, (_, i) => episode(`e${i}`, { text: 'x'.repeat(20_000) })),
    )
    const cloud = groupEpisodes(many, false)
    expect(cloud.every((g) => g.episodes.length <= 3)).toBe(true)
    expect(cloud.flatMap((g) => g.episodes).every((e) => e.text.length <= 6000)).toBe(true)
    const device = groupEpisodes(many, true)
    expect(device).toHaveLength(7)
    expect(device[0]?.episodes[0]?.text.length).toBeLessThanOrEqual(4500)
  })

  it('returns no results for no episodes without calling a model', async () => {
    const h = brainHarness()
    expect(await h.brain.extract(input([]))).toEqual({ results: [] })
    expect(h.groq.requests).toHaveLength(0)
  })
})

describe('P1 highlights', () => {
  const highlighted = episode('h1', {
    signals: { ...signals, highlights: ['James Finlayson founded a cotton mill in 1820'] },
  })

  it('shows highlights to the model as notes the student marked', () => {
    const user = buildExtractUser(input([highlighted]), '2026-10-24')
    expect(user).toContain('Student highlighted (marked as important):')
    expect(user).toContain('- James Finlayson founded a cotton mill in 1820')
    expect(buildExtractUser(input([episode('e1')]), '2026-10-24')).not.toContain('highlighted')
  })

  it('never lets an episode with highlights come back as not learning', () => {
    const out = finalizeExtract(
      {
        results: [
          {
            episodeId: 'h1',
            reason: 'Tourism page',
            isLearning: false,
            confidence: 0.8,
            items: [],
            studentPrompts: [],
          },
        ],
      },
      input([highlighted]),
    )
    const r = out.results[0]
    expect(r?.isLearning).toBe(true)
    expect(r?.items[0]?.seen).toContain('"James Finlayson founded a cotton mill in 1820"')
    expect(r?.items[0]?.keyTerms).toEqual(['James Finlayson founded a cotton mill in 1820'])
  })

  it('adds a highlight the model left out to the first item', () => {
    const out = finalizeExtract(
      {
        results: [
          {
            episodeId: 'h1',
            reason: 'Reading about Tampere history',
            isLearning: true,
            confidence: 0.9,
            items: [
              item({
                seen: 'Tampere grew around the Tammerkoski rapids.',
              }) as LlmExtract['results'][number]['items'][number],
            ],
            studentPrompts: [],
          },
        ],
      },
      input([highlighted]),
    )
    expect(out.results[0]?.items[0]?.seen).toBe(
      'Tampere grew around the Tammerkoski rapids. Highlighted: "James Finlayson founded a cotton mill in 1820"',
    )
  })
})
