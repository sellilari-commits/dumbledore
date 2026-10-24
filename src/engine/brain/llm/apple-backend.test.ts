import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import type { HelperClient, HelperStatus } from '../../contracts'
import { createAppleBackend } from './apple-backend'

function fakeHelper(opts: { available?: boolean; status?: HelperStatus; json?: unknown } = {}) {
  const calls: { method: string; params: unknown }[] = []
  const helper = {
    status: opts.status ?? 'connected',
    start: async () => {},
    stop: async () => {},
    on: () => () => {},
    onStatus: () => () => {},
    call: async (method: string, params: unknown) => {
      calls.push({ method, params })
      if (method === 'llm.onDevice.status') {
        return {
          available: opts.available ?? true,
          reason: opts.available === false ? 'appleIntelligenceNotEnabled' : null,
          contextSize: 4096,
        }
      }
      return { json: opts.json ?? { ok: true }, tokensIn: 300, tokensOut: 40 }
    },
  } as unknown as HelperClient
  return { helper, calls }
}

const req = {
  model: 'system',
  system: 'instructions',
  messages: [{ role: 'user' as const, content: 'episode text' }],
  output: { kind: 'json' as const, name: 'x', schema: { type: 'object' } },
  temperature: 0.1,
  maxOutputTokens: 500,
  reasoningEffort: null,
  signal: new AbortController().signal,
}

describe('Apple on-device backend', () => {
  it('reports availability from the helper and caches it', async () => {
    const clock = new FakeClock()
    const { helper, calls } = fakeHelper()
    const apple = createAppleBackend({ helper, clock })
    expect(await apple.availability()).toEqual({ ok: true, reason: null })
    await apple.availability()
    expect(calls.filter((c) => c.method === 'llm.onDevice.status')).toHaveLength(1)
    clock.advance(61_000)
    await apple.availability()
    expect(calls.filter((c) => c.method === 'llm.onDevice.status')).toHaveLength(2)
  })

  it('is unavailable without a helper, when disconnected, switched off or not ready', async () => {
    const clock = new FakeClock()
    expect((await createAppleBackend({ helper: null, clock }).availability()).ok).toBe(false)
    const down = fakeHelper({ status: 'down' }).helper
    expect((await createAppleBackend({ helper: down, clock }).availability()).reason).toBe(
      'helper down',
    )
    const off = createAppleBackend({ helper: fakeHelper().helper, clock, enabled: () => false })
    expect((await off.availability()).ok).toBe(false)
    const notReady = createAppleBackend({ helper: fakeHelper({ available: false }).helper, clock })
    expect((await notReady.availability()).reason).toBe('appleIntelligenceNotEnabled')
  })

  it('sends instructions, prompt and schema; returns JSON text and usage', async () => {
    const { helper, calls } = fakeHelper({ json: { results: [] } })
    const apple = createAppleBackend({ helper, clock: new FakeClock() })
    const res = await apple.generate(req)
    expect(res.text).toBe('{"results":[]}')
    expect(res.usage).toEqual({ inputTokens: 300, outputTokens: 40 })
    expect(calls[0]).toEqual({
      method: 'llm.onDevice.generate',
      params: {
        instructions: 'instructions',
        prompt: 'episode text',
        schema: { type: 'object' },
        maxTokens: 500,
        temperature: 0.1,
      },
    })
  })

  it('refuses requests without a schema', async () => {
    const apple = createAppleBackend({ helper: fakeHelper().helper, clock: new FakeClock() })
    const err = await apple.generate({ ...req, output: { kind: 'text' } }).catch((e) => e)
    expect(err.kind).toBe('bad_request')
  })
})
