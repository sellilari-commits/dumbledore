/**
 * Brain.webSearch: one grounded Gemini call (google_search provider tool) through the router;
 * the answer and its sources come back cleaned; no key → 'no-key' with nothing sent; Gemini only
 * (never a fallback without search); deadline and abort honoured; usage logged like any call.
 */
import { BrainTimeoutError, BrainUnavailableError } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { FakeClock, systemClock } from '../clock'
import { createMemoryRepos } from '../testing/memory-repos'
import { createBrain } from './brain'
import { BackendError } from './llm/types'
import { FakeBackend } from './testing/fake-backend'
import { brainHarness, R } from './testing/harness'
import { cleanSources, clipWords, WEB_SEARCH_MAX_WORDS } from './web-search'

function webSearchOf(brain: ReturnType<typeof brainHarness>['brain']) {
  const search = brain.webSearch
  if (!search) throw new Error('webSearch missing')
  return search
}

interface Captured {
  url: string
  body: Record<string, unknown>
  headers: Record<string, string>
}

/** Fake Google API: records each request, answers with `respond`. */
function fakeFetch(respond: (c: Captured) => Response) {
  const calls: Captured[] = []
  const fetch = async (input: Parameters<typeof globalThis.fetch>[0], init?: RequestInit) => {
    const headers: Record<string, string> = {}
    new Headers(init?.headers).forEach((v, k) => {
      headers[k] = v
    })
    const c = { url: String(input), body: JSON.parse(String(init?.body ?? '{}')), headers }
    calls.push(c)
    return respond(c)
  }
  return { calls, fetch: fetch as typeof globalThis.fetch }
}

const groundedReply = (text: string, chunks: { uri: string; title?: string }[]) =>
  new Response(
    JSON.stringify({
      candidates: [
        {
          content: { role: 'model', parts: [{ text }] },
          finishReason: 'STOP',
          index: 0,
          groundingMetadata: {
            webSearchQueries: ['nobel prize chemistry 2025'],
            groundingChunks: chunks.map((web) => ({ web })),
          },
        },
      ],
      usageMetadata: { promptTokenCount: 40, candidatesTokenCount: 60, totalTokenCount: 100 },
      modelVersion: 'gemini-3.5-flash',
      responseId: 'r1',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

describe('Brain.webSearch', () => {
  it('sends one grounded Gemini request and returns the answer with cleaned sources', async () => {
    const clock = new FakeClock('2026-10-25T08:00:00.000Z')
    const repos = createMemoryRepos(clock)
    const logged: { task: string; provider: string; ok: boolean }[] = []
    const usage = {
      ...repos.usage,
      record: (call: Parameters<typeof repos.usage.record>[0]) => {
        logged.push({ task: call.task, provider: call.provider, ok: call.ok })
        repos.usage.record(call)
      },
    }
    const f = fakeFetch(() =>
      groundedReply('The 2025 Nobel Prize in Chemistry went to MOF research.', [
        { uri: 'https://www.nobelprize.org/prizes/chemistry/2025/', title: 'nobelprize.org' },
        { uri: 'https://www.nobelprize.org/prizes/chemistry/2025/', title: 'duplicate' },
        { uri: 'https://en.wikipedia.org/wiki/MOF', title: 'wikipedia.org' },
        { uri: 'javascript:alert(1)', title: 'bad' },
        { uri: 'ftp://files.example.org/x', title: 'ftp' },
      ]),
    )
    const groq = new FakeBackend('groq')
    const brain = createBrain({
      clock,
      usage,
      keys: (name) => (name === 'GEMINI_API_KEY' ? 'g-test-key' : undefined),
      fetch: f.fetch,
      backends: { groq },
      routes: () => [R.gemini, R.groq],
      cache: null,
    })
    const out = await webSearchOf(brain)('  who won the 2025 chemistry nobel ')
    expect(out).toEqual({
      answer: 'The 2025 Nobel Prize in Chemistry went to MOF research.',
      sources: [
        { title: 'nobelprize.org', url: 'https://www.nobelprize.org/prizes/chemistry/2025/' },
        { title: 'wikipedia.org', url: 'https://en.wikipedia.org/wiki/MOF' },
      ],
    })
    expect(f.calls).toHaveLength(1)
    const call = f.calls[0] as Captured
    expect(call.url).toContain('/models/gemini-3.5-flash:generateContent')
    expect(call.url).not.toContain('g-test-key')
    expect(call.body.tools).toEqual([{ googleSearch: {} }])
    expect(JSON.stringify(call.body.contents)).toContain('who won the 2025 chemistry nobel')
    expect(groq.requests).toHaveLength(0)
    // logged like any call, so the spend cap and the usage view see it
    expect(logged).toEqual([{ task: 'webSearch', provider: 'gemini', ok: true }])
  })

  it('resolves no-key without a Gemini key and sends nothing anywhere', async () => {
    const h = brainHarness([R.gemini, R.groq])
    h.gemini.available = { ok: false, reason: 'GEMINI_API_KEY not set' }
    expect(await webSearchOf(h.brain)('capital of Finland')).toBe('no-key')
    expect(h.gemini.requests).toHaveLength(0)
    expect(h.groq.requests).toHaveLength(0)
  })

  it('never falls back to a model without search', async () => {
    const h = brainHarness([R.gemini, R.groq, R.ovh])
    h.gemini.fallback = { error: new BackendError('auth', 'API key not valid') }
    h.groq.fallback = { text: 'from memory' }
    h.ovh.fallback = { text: 'from memory' }
    const err = await webSearchOf(h.brain)('latest news').catch((e) => e)
    expect(err).toBeInstanceOf(BrainUnavailableError)
    expect(h.gemini.requests[0]?.grounding).toBe('web_search')
    expect(h.groq.requests).toHaveLength(0)
    expect(h.ovh.requests).toHaveLength(0)
  })

  it('clips a long answer and caps the sources at 6', async () => {
    const h = brainHarness([R.gemini])
    const long = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ')
    h.gemini.queue({
      text: long,
      sources: Array.from({ length: 9 }, (_, i) => ({ title: '', url: `https://s${i}.org/a` })),
    })
    const out = await webSearchOf(h.brain)('long one')
    if (out === 'no-key') throw new Error('unexpected no-key')
    expect(out.answer.split(' ')).toHaveLength(WEB_SEARCH_MAX_WORDS)
    expect(out.answer.endsWith('…')).toBe(true)
    expect(out.sources).toHaveLength(6)
    expect(out.sources[0]).toEqual({ title: 's0.org', url: 'https://s0.org/a' })
  })

  it('times out at the deadline', async () => {
    const h = brainHarness([R.gemini], { clock: systemClock })
    h.gemini.queue({ text: 'late', delayMs: 5000 })
    const started = Date.now()
    const err = await webSearchOf(h.brain)('slow', { timeoutMs: 150 }).catch((e) => e)
    expect(err).toBeInstanceOf(BrainTimeoutError)
    expect(Date.now() - started).toBeLessThan(2000)
  }, 10_000)

  it('stops when the caller aborts', async () => {
    const h = brainHarness([R.gemini], { clock: systemClock })
    h.gemini.queue({ text: 'late', delayMs: 5000 })
    const control = new AbortController()
    const p = webSearchOf(h.brain)('slow', { signal: control.signal }).catch((e) => e)
    setTimeout(() => control.abort(), 50)
    const err = await p
    expect((err as Error).name).toBe('AbortError')
  }, 10_000)
})

describe('web search helpers', () => {
  it('clipWords keeps short text and cuts long text with an ellipsis', () => {
    expect(clipWords('  a   b c ')).toBe('a b c')
    expect(clipWords('one two three, four', 3)).toBe('one two three…')
  })

  it('cleanSources keeps http(s) only, dedupes and falls back to the host as title', () => {
    expect(
      cleanSources([
        { title: ' A\n page ', url: 'https://a.org/x' },
        { title: 'again', url: 'https://a.org/x' },
        { title: 'data', url: 'data:text/html,hi' },
        { title: 'file', url: 'file:///etc/passwd' },
        { title: 'junk', url: 'not a url' },
        { title: '', url: 'http://b.org' },
      ]),
    ).toEqual([
      { title: 'A page', url: 'https://a.org/x' },
      { title: 'b.org', url: 'http://b.org/' },
    ])
  })
})
