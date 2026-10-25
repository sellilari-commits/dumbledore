/**
 * Chat tool web_search: the answer and its http(s) sources go back to the model; no key says
 * where to add one; failures never throw; at most 3 searches per turn until resetTurn();
 * sourcesMarkdown renders safe links.
 */
import { BrainTimeoutError, BrainUnavailableError } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { createWebSearchTool, NO_KEY_MESSAGE, sourcesMarkdown, WebSearchInput } from './web-search'

const answer = {
  answer: 'Helsinki is the capital of Finland.',
  sources: [
    { title: 'Helsinki - Wikipedia', url: 'https://en.wikipedia.org/wiki/Helsinki' },
    { title: 'evil', url: 'javascript:alert(1)' },
    { title: 'local', url: 'file:///etc/hosts' },
  ],
}

describe('web_search tool', () => {
  it('returns the answer with http(s) sources only and collects them for the turn', async () => {
    const queries: string[] = []
    const web = createWebSearchTool({
      search: async (q) => {
        queries.push(q)
        return answer
      },
    })
    const out = await web.tool.run({ query: '  capital   of Finland ' }, {})
    expect(out.ok).toBe(true)
    expect(out.result).toEqual({
      answer: 'Helsinki is the capital of Finland.',
      sources: [{ title: 'Helsinki - Wikipedia', url: 'https://en.wikipedia.org/wiki/Helsinki' }],
    })
    expect(out.receipts).toEqual([])
    expect(queries).toEqual(['capital of Finland'])
    await web.tool.run({ query: 'again' }, {})
    expect(web.turnSources()).toEqual([
      { title: 'Helsinki - Wikipedia', url: 'https://en.wikipedia.org/wiki/Helsinki' },
    ])
  })

  it('tells the model where to add a Gemini key, without using up the turn', async () => {
    const web = createWebSearchTool({ search: async () => 'no-key', maxPerTurn: 1 })
    const out = await web.tool.run({ query: 'anything' }, {})
    expect(out).toMatchObject({ ok: false, result: { error: NO_KEY_MESSAGE } })
    expect(NO_KEY_MESSAGE).toContain('Settings → AI providers')
    const again = await web.tool.run({ query: 'anything' }, {})
    expect((again.result as { error: string }).error).toBe(NO_KEY_MESSAGE)
  })

  it('turns a timeout, spend cap or other failure into a failure, never a throw', async () => {
    const errors = [
      new BrainTimeoutError('webSearch'),
      new BrainUnavailableError('webSearch', 'gemini:gemini-3.5-flash: over-budget'),
      new Error('boom'),
    ]
    const web = createWebSearchTool({
      search: async () => {
        throw errors.shift()
      },
    })
    const lines: string[] = []
    for (let i = 0; i < 3; i++) {
      const out = await web.tool.run({ query: 'news today' }, {})
      expect(out.ok).toBe(false)
      lines.push((out.result as { error: string }).error)
    }
    expect(lines[0]).toMatch(/took too long/)
    expect(lines[1]).toMatch(/spend cap/)
    expect(lines[2]).toMatch(/unavailable right now/)
  })

  it('passes the abort signal through', async () => {
    let seen: AbortSignal | undefined
    const web = createWebSearchTool({
      search: async (_q, signal) => {
        seen = signal
        return answer
      },
    })
    const control = new AbortController()
    await web.tool.run({ query: 'x y' }, { signal: control.signal })
    expect(seen).toBe(control.signal)
  })

  it('allows 3 searches per turn, then refuses until resetTurn()', async () => {
    let calls = 0
    const web = createWebSearchTool({
      search: async () => {
        calls++
        return answer
      },
    })
    const runs = await Promise.all([1, 2, 3, 4].map((i) => web.tool.run({ query: `q ${i}` }, {})))
    expect(runs.map((r) => r.ok)).toEqual([true, true, true, false])
    expect(runs[3]?.result).toMatchObject({ error: expect.stringMatching(/limit reached.*\(3\)/) })
    expect(calls).toBe(3)
    web.resetTurn()
    expect(web.turnSources()).toEqual([])
    expect((await web.tool.run({ query: 'next turn' }, {})).ok).toBe(true)
    expect(calls).toBe(4)
  })

  it('validates the input', () => {
    expect(WebSearchInput.safeParse({ query: 'ok query' }).success).toBe(true)
    expect(WebSearchInput.safeParse({ query: '' }).success).toBe(false)
    expect(WebSearchInput.safeParse({}).success).toBe(false)
  })

  it('describes when to search and that links are never opened', () => {
    const d = createWebSearchTool({ search: async () => answer }).tool.description
    expect(d).toMatch(/outside the student's own Dumbledore data/)
    expect(d).toMatch(/Never open a link/)
  })
})

describe('sourcesMarkdown', () => {
  it('renders deduped http(s) links with escaped titles', () => {
    expect(
      sourcesMarkdown([
        { title: 'A [draft] page', url: 'https://a.org/x_(y)' },
        { title: 'dup', url: 'https://a.org/x_(y)' },
        { title: 'bad', url: 'javascript:alert(1)' },
        { title: '', url: 'http://b.org' },
      ]),
    ).toBe('Sources: [A \\[draft\\] page](https://a.org/x_%28y%29) · [b.org](http://b.org/)')
  })

  it('is empty without usable sources', () => {
    expect(sourcesMarkdown([])).toBe('')
    expect(sourcesMarkdown([{ title: 'x', url: 'data:text/html,hi' }])).toBe('')
  })
})
