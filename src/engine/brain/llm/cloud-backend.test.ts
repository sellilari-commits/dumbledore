import { describe, expect, it } from 'vitest'
import { createCloudBackend } from './cloud-backend'
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

const completion = (content: string, extraHeaders: Record<string, string> = {}) =>
  new Response(
    JSON.stringify({
      id: 'c1',
      object: 'chat.completion',
      created: 1,
      model: 'm',
      choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
    }),
    { status: 200, headers: { 'content-type': 'application/json', ...extraHeaders } },
  )

const schema = {
  type: 'object',
  properties: { a: { type: 'string' } },
  required: ['a'],
  additionalProperties: false,
}

const request = (over: Partial<BackendRequest> = {}): BackendRequest => ({
  model: 'openai/gpt-oss-20b',
  system: 'You are terse.',
  messages: [{ role: 'user', content: 'hi' }],
  output: { kind: 'json', name: 'thing', schema },
  temperature: 0.1,
  maxOutputTokens: 300,
  reasoningEffort: 'low',
  signal: new AbortController().signal,
  ...over,
})

const keys = (k: Record<string, string>) => (name: string) => k[name]

describe('cloud backend over the AI SDK', () => {
  it('Groq: strict json_schema, reasoning effort, key header, usage and headers', async () => {
    const f = fakeFetch(() => completion('{"a":"x"}', { 'x-ratelimit-remaining-tokens': '7000' }))
    const groq = createCloudBackend('groq', {
      keys: keys({ GROQ_API_KEY: 'gsk_test' }),
      fetch: f.fetch,
    })
    const res = await groq.generate(request())
    expect(res.text).toBe('{"a":"x"}')
    expect(res.usage).toEqual({ inputTokens: 120, outputTokens: 30 })
    expect(res.headers['x-ratelimit-remaining-tokens']).toBe('7000')
    const call = f.calls[0] as Captured
    expect(call.url).toBe('https://api.groq.com/openai/v1/chat/completions')
    expect(call.headers.authorization).toBe('Bearer gsk_test')
    expect(call.body.response_format).toMatchObject({
      type: 'json_schema',
      json_schema: { name: 'thing', strict: true, schema },
    })
    expect(call.body.reasoning_effort).toBe('low')
    expect(call.body.max_tokens).toBe(300)
    expect((call.body.messages as { role: string }[])[0]?.role).toBe('system')
  })

  it('Groq: models without schema support get JSON mode', async () => {
    const f = fakeFetch(() => completion('{"a":"y"}'))
    const groq = createCloudBackend('groq', { keys: keys({ GROQ_API_KEY: 'k' }), fetch: f.fetch })
    expect(groq.supportsJsonSchema('qwen/qwen3.8-27b')).toBe(false)
    await groq.generate(
      request({ model: 'qwen/qwen3.8-27b', output: { kind: 'json', name: 't', schema: null } }),
    )
    const body = f.calls[0]?.body as Record<string, unknown>
    expect(body.response_format).toEqual({ type: 'json_object' })
    expect(body.reasoning_effort).toBeUndefined()
    expect(body.reasoning_format).toBe('hidden')
  })

  it('OVHcloud: keyless, schema mode, reasoning effort only for gpt-oss', async () => {
    const f = fakeFetch(() => completion('{"a":"z"}'))
    const ovh = createCloudBackend('ovh', { keys: keys({}), fetch: f.fetch })
    expect(await ovh.availability()).toEqual({ ok: true, reason: null })
    await ovh.generate(request({ model: 'gpt-oss-20b' }))
    await ovh.generate(request({ model: 'Qwen3.8-27B' }))
    const [a, b] = f.calls as [Captured, Captured]
    expect(a.url).toBe('https://oai.endpoints.kepler.ai.cloud.ovh.net/v1/chat/completions')
    expect(a.headers.authorization).toBeUndefined()
    expect(a.body.response_format).toMatchObject({ type: 'json_schema' })
    expect(a.body.reasoning_effort).toBe('low')
    expect(b.body.chat_template_kwargs).toBeUndefined()
    expect(b.body.reasoning_effort).toBeUndefined()
  })

  it('reports a missing key as unavailable', async () => {
    const groq = createCloudBackend('groq', { keys: keys({}) })
    expect((await groq.availability()).ok).toBe(false)
    const mistral = createCloudBackend('mistral', { keys: keys({ MISTRAL_API_KEY: 'm' }) })
    expect((await mistral.availability()).ok).toBe(true)
  })

  it('maps 429 to a rate-limit error with retry-after', async () => {
    const f = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'Rate limit reached', type: 'tokens' } }), {
          status: 429,
          headers: { 'content-type': 'application/json', 'retry-after': '7' },
        }),
    )
    const groq = createCloudBackend('groq', { keys: keys({ GROQ_API_KEY: 'k' }), fetch: f.fetch })
    const err = await groq.generate(request()).catch((e) => e)
    expect(err.name).toBe('BackendError')
    expect(err.kind).toBe('rate_limit')
    expect(err.retryAfterMs).toBe(7000)
    expect(err.retryable).toBe(true)
  })

  it('maps 5xx to a retryable server error and 401 to auth', async () => {
    let status = 503
    const f = fakeFetch(
      () =>
        new Response(JSON.stringify({ error: { message: 'nope' } }), {
          status,
          headers: { 'content-type': 'application/json' },
        }),
    )
    const ovh = createCloudBackend('ovh', { keys: keys({}), fetch: f.fetch })
    expect((await ovh.generate(request()).catch((e) => e)).kind).toBe('server')
    status = 401
    expect((await ovh.generate(request()).catch((e) => e)).kind).toBe('auth')
  })

  it('returns unparseable JSON text instead of throwing, for the repair step', async () => {
    const f = fakeFetch(() => completion('{"a": "unterminated'))
    const ovh = createCloudBackend('ovh', { keys: keys({}), fetch: f.fetch })
    const res = await ovh.generate(request({ model: 'gpt-oss-20b' }))
    expect(res.text).toBe('{"a": "unterminated')
  })

  it('sends tools and returns tool calls', async () => {
    const f = fakeFetch(
      () =>
        new Response(
          JSON.stringify({
            id: 'c2',
            object: 'chat.completion',
            created: 1,
            model: 'm',
            choices: [
              {
                index: 0,
                message: {
                  role: 'assistant',
                  content: null,
                  tool_calls: [
                    {
                      id: 't1',
                      type: 'function',
                      function: { name: 'open_subject', arguments: '{"subjectId":"sub_1"}' },
                    },
                  ],
                },
                finish_reason: 'tool_calls',
              },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        ),
    )
    const groq = createCloudBackend('groq', { keys: keys({ GROQ_API_KEY: 'k' }), fetch: f.fetch })
    const res = await groq.generate(
      request({
        output: { kind: 'text' },
        tools: [{ name: 'open_subject', description: 'Open', parameters: schema }],
      }),
    )
    expect(res.toolCalls).toEqual([{ name: 'open_subject', input: { subjectId: 'sub_1' } }])
    const body = f.calls[0]?.body as Record<string, unknown>
    expect((body.tools as { function: { name: string } }[])[0]?.function.name).toBe('open_subject')
    expect(body.response_format).toBeUndefined()
  })
})
