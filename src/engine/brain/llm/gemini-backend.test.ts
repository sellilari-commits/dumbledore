import { describe, expect, it } from 'vitest'
import { createGeminiBackend, toGeminiError } from './gemini-backend'
import type { BackendRequest } from './types'

interface Captured {
  url: string
  body: Record<string, unknown>
  headers: Record<string, string>
}

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

const usageMetadata = {
  promptTokenCount: 120,
  candidatesTokenCount: 30,
  thoughtsTokenCount: 50,
  totalTokenCount: 200,
}

const reply = (parts: unknown[], finishReason = 'STOP') =>
  new Response(
    JSON.stringify({
      candidates: [{ content: { role: 'model', parts }, finishReason, index: 0 }],
      usageMetadata,
      modelVersion: 'gemini-3.5-flash-lite',
      responseId: 'r1',
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  )

const googleError = (code: number, status: string, message: string, details: unknown[] = []) =>
  new Response(JSON.stringify({ error: { code, message, status, details } }), {
    status: code,
    headers: { 'content-type': 'application/json' },
  })

const schema = {
  type: 'object',
  properties: { a: { type: 'string' } },
  required: ['a'],
  additionalProperties: false,
}

const request = (over: Partial<BackendRequest> = {}): BackendRequest => ({
  model: 'gemini-3.5-flash-lite',
  system: 'You are terse.',
  messages: [{ role: 'user', content: 'hi' }],
  output: { kind: 'json', name: 'thing', schema },
  temperature: 0.1,
  maxOutputTokens: 300,
  reasoningEffort: 'low',
  tier: 'extract',
  signal: new AbortController().signal,
  ...over,
})

const keys = (k: Record<string, string>) => (name: string) => k[name]
const gen = (body: Record<string, unknown>) => body.generationConfig as Record<string, unknown>

describe('Gemini backend', () => {
  it('sends the key explicitly, the JSON schema, the tier thinking level and no temperature', async () => {
    const f = fakeFetch(() => reply([{ text: '{"a":"x"}' }]))
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'g-test' }), fetch: f.fetch })
    const res = await gemini.generate(request())
    expect(res.text).toBe('{"a":"x"}')
    // thinking tokens are billed as output: they are in outputTokens
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 80 })
    const call = f.calls[0] as Captured
    expect(call.url).toBe(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent',
    )
    expect(call.headers['x-goog-api-key']).toBe('g-test')
    expect(call.url).not.toContain('g-test')
    const g = gen(call.body)
    expect(g.responseMimeType).toBe('application/json')
    expect(g.responseJsonSchema).toMatchObject({ type: 'object', required: ['a'] })
    expect(g.thinkingConfig).toEqual({ thinkingLevel: 'minimal' })
    expect(g.maxOutputTokens).toBe(300 + 512)
    expect(g.temperature).toBeUndefined()
    expect(call.body.systemInstruction).toBeDefined()
  })

  it('thinks moderately for reason, keeps the temperature on pre-3 models', async () => {
    const f = fakeFetch(() => reply([{ text: '{"a":"y"}' }]))
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'k' }), fetch: f.fetch })
    await gemini.generate(request({ model: 'gemini-3.5-flash', tier: 'reason' }))
    await gemini.generate(
      request({ model: 'gemini-2.5-flash', tier: undefined, reasoningEffort: 'high' }),
    )
    const [a, b] = f.calls.map((c) => gen(c.body))
    expect(a?.thinkingConfig).toEqual({ thinkingLevel: 'low' })
    expect(a?.maxOutputTokens).toBe(300 + 2048)
    expect(b?.thinkingConfig).toEqual({ thinkingLevel: 'medium' })
    expect(b?.temperature).toBe(0.1)
    expect(gemini.billableOutputTokens?.('gemini-3.5-flash', 'write', 900)).toBe(900 + 512)
  })

  it('is unavailable without a key and never calls out', async () => {
    const f = fakeFetch(() => reply([{ text: '{}' }]))
    const gemini = createGeminiBackend({ keys: keys({}), fetch: f.fetch })
    expect(await gemini.availability()).toEqual({ ok: false, reason: 'GEMINI_API_KEY not set' })
    const err = await gemini.generate(request()).catch((e) => e)
    expect(err.kind).toBe('unavailable')
    expect(f.calls).toHaveLength(0)
  })

  it('maps 429 RESOURCE_EXHAUSTED to a rate limit with Google retryDelay', async () => {
    const f = fakeFetch(() =>
      googleError(429, 'RESOURCE_EXHAUSTED', 'Resource has been exhausted (e.g. check quota).', [
        { '@type': 'type.googleapis.com/google.rpc.RetryInfo', retryDelay: '17s' },
      ]),
    )
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'k' }), fetch: f.fetch })
    const err = await gemini.generate(request()).catch((e) => e)
    expect(err.name).toBe('BackendError')
    expect(err.kind).toBe('rate_limit')
    expect(err.retryAfterMs).toBe(17_000)
    expect(err.retryable).toBe(true)
  })

  it('maps an invalid key to auth (not retried) and 503 to a server error', async () => {
    let next = () =>
      googleError(400, 'INVALID_ARGUMENT', 'API key not valid. Please pass a valid API key.')
    const f = fakeFetch(() => next())
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'bad' }), fetch: f.fetch })
    const auth = await gemini.generate(request()).catch((e) => e)
    expect(auth.kind).toBe('auth')
    expect(auth.message).not.toContain('bad')
    next = () => googleError(503, 'UNAVAILABLE', 'The model is overloaded.')
    expect((await gemini.generate(request()).catch((e) => e)).kind).toBe('server')
  })

  it('classifies in-stream error objects', () => {
    const signal = new AbortController().signal
    const quota = toGeminiError(
      { message: 'quota', type: 'RESOURCE_EXHAUSTED', statusCode: 429, data: {} },
      signal,
    )
    expect(quota.kind).toBe('rate_limit')
    expect(toGeminiError({ message: 'x', type: 'INTERNAL', statusCode: 500 }, signal).kind).toBe(
      'server',
    )
  })

  it('returns function calls as tool calls', async () => {
    const f = fakeFetch(() =>
      reply([{ functionCall: { name: 'open_subject', args: { subjectId: 'sub_1' } } }]),
    )
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'k' }), fetch: f.fetch })
    const res = await gemini.generate(
      request({
        tier: 'chat',
        output: { kind: 'text' },
        tools: [{ name: 'open_subject', description: 'Open', parameters: schema }],
      }),
    )
    expect(res.toolCalls).toEqual([{ name: 'open_subject', input: { subjectId: 'sub_1' } }])
    const body = f.calls[0]?.body as { tools: { functionDeclarations: { name: string }[] }[] }
    expect(body.tools[0]?.functionDeclarations[0]?.name).toBe('open_subject')
    expect(gen(f.calls[0]?.body ?? {}).responseMimeType).toBeUndefined()
  })

  it('streams text deltas and a finish with usage', async () => {
    const chunk = (parts: unknown[], extra: Record<string, unknown> = {}) =>
      `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts }, index: 0, ...extra }] })}\n\n`
    const body =
      chunk([{ text: 'Hel' }]) +
      chunk([{ text: 'lo' }]) +
      `data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: '' }] }, finishReason: 'STOP', index: 0 }], usageMetadata })}\n\n`
    const f = fakeFetch(
      () => new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }),
    )
    const gemini = createGeminiBackend({ keys: keys({ GEMINI_API_KEY: 'k' }), fetch: f.fetch })
    const parts = []
    for await (const p of gemini.stream(request({ output: { kind: 'text' }, tier: 'chat' })))
      parts.push(p)
    expect(f.calls[0]?.url).toContain(':streamGenerateContent?alt=sse')
    expect(
      parts
        .filter((p) => p.type === 'text')
        .map((p) => (p.type === 'text' ? p.delta : ''))
        .join(''),
    ).toBe('Hello')
    expect(parts.at(-1)).toMatchObject({
      type: 'finish',
      usage: { inputTokens: 120, outputTokens: 80 },
    })
  })
})
