import { BrainTimeoutError, BrainUnavailableError } from '@engine/brain-contract'
import type { ModelRoute } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import { FakeClock, systemClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { FakeBackend } from '../testing/fake-backend'
import { type CallPlan, InvalidOutputError, Router, type RouterDeps } from './router'
import { BackendError } from './types'

const GROQ: ModelRoute = { provider: 'groq', model: 'openai/gpt-oss-20b' }
const OVH: ModelRoute = { provider: 'ovh', model: 'gpt-oss-20b' }
const APPLE: ModelRoute = { provider: 'apple', model: 'system' }

function setup(routes: ModelRoute[], extra: Partial<RouterDeps> = {}) {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const groq = new FakeBackend('groq')
  const ovh = new FakeBackend('ovh')
  const apple = new FakeBackend('apple')
  const router = new Router({
    backends: { groq, ovh, apple },
    clock,
    usage: repos.usage,
    routes: () => routes,
    sleep: async (ms) => clock.advance(ms),
    ...extra,
  })
  const plan = (p: Partial<CallPlan> = {}): CallPlan => ({
    task: 'test',
    tier: 'write',
    deadline: clock.now() + 10_000,
    estimatedTokens: 500,
    language: 'en',
    onDeviceOk: true,
    ...p,
  })
  const call = (p?: Partial<CallPlan>) =>
    router.run(plan(p), async (a) => {
      const res = await a.call({
        system: 'sys',
        messages: [{ role: 'user', content: 'hello' }],
        output: { kind: 'text' },
        temperature: 0,
        maxOutputTokens: 100,
        reasoningEffort: null,
      })
      return `${a.route.provider}:${res.text}`
    })
  return { clock, repos, groq, ovh, apple, router, call, plan }
}

describe('Router fall-through and retries', () => {
  it('falls through to the next route on a server error and logs both calls', async () => {
    const t = setup([GROQ, OVH])
    t.groq.queue({ error: new BackendError('server', 'boom', { status: 500 }) })
    t.groq.queue({ error: new BackendError('server', 'boom again', { status: 503 }) })
    t.ovh.queue({ text: 'ok' })
    // first pick is groq; after the error groq cools down briefly, ovh is ready → used
    expect(await t.call()).toBe('ovh:ok')
    const rows = t.repos.usage.rowsSince('2000-01-01')
    expect(rows.find((r) => r.provider === 'groq')?.failures).toBe(1)
    expect(rows.find((r) => r.provider === 'ovh')?.calls).toBe(1)
  })

  it('retries the same route after a transient error when it is the only one', async () => {
    const t = setup([GROQ])
    t.groq.queue({ error: new BackendError('network', 'reset') }, { text: 'second try' })
    expect(await t.call()).toBe('groq:second try')
    expect(t.groq.requests).toHaveLength(2)
  })

  it('does not retry auth errors and reports every reason when all routes fail', async () => {
    const t = setup([GROQ, OVH])
    t.groq.queue({ error: new BackendError('auth', 'bad key', { status: 401 }) })
    t.ovh.queue({ error: new BackendError('bad_request', 'nope', { status: 400 }) })
    const err = await t.call().catch((e) => e)
    expect(err).toBeInstanceOf(BrainUnavailableError)
    expect(String(err.message)).toMatch(/groq.*auth/)
    expect(String(err.message)).toMatch(/ovh.*bad_request/)
    expect(t.groq.requests).toHaveLength(1)
  })

  it('on 429 cools the route down and moves on', async () => {
    const t = setup([GROQ, OVH])
    t.groq.queue({
      error: new BackendError('rate_limit', 'slow down', { status: 429, retryAfterMs: 30_000 }),
    })
    t.ovh.queue({ text: 'from ovh' }, { text: 'again ovh' })
    expect(await t.call()).toBe('ovh:from ovh')
    // groq is still cooling down: the next call goes straight to ovh
    expect(await t.call()).toBe('ovh:again ovh')
    expect(t.groq.requests).toHaveLength(1)
  })

  it('moves on when the attempt rejects the output as invalid', async () => {
    const t = setup([GROQ, OVH])
    t.groq.queue({ text: 'bad' })
    t.ovh.queue({ text: 'good' })
    const out = await t.router.run(t.plan(), async (a) => {
      const res = await a.call({
        system: 's',
        messages: [{ role: 'user', content: 'u' }],
        output: { kind: 'text' },
        temperature: 0,
        maxOutputTokens: 10,
        reasoningEffort: null,
      })
      if (res.text === 'bad') throw new InvalidOutputError('not usable')
      return res.text
    })
    expect(out).toBe('good')
  })
})

describe('Router candidate selection', () => {
  it('skips providers without a key', async () => {
    const t = setup([GROQ, OVH])
    t.groq.available = { ok: false, reason: 'GROQ_API_KEY not set' }
    t.ovh.queue({ text: 'keyless' })
    expect(await t.call()).toBe('ovh:keyless')
    const { skipped } = await t.router.candidates(t.plan())
    expect(skipped.join()).toMatch(/GROQ_API_KEY not set/)
  })

  it('never sends Finnish content or unsuited tasks to the on-device model', async () => {
    const t = setup([APPLE, OVH])
    t.ovh.fallback = { text: 'cloud' }
    expect(await t.call({ language: 'fi' })).toBe('ovh:cloud')
    expect(await t.call({ onDeviceOk: false })).toBe('ovh:cloud')
    t.apple.queue({ text: 'local' })
    expect(await t.call()).toBe('apple:local')
    expect(t.apple.requests).toHaveLength(1)
  })

  it('skips the on-device model when the request exceeds its 4K context', async () => {
    const t = setup([APPLE, OVH])
    t.ovh.queue({ text: 'cloud' })
    expect(await t.call({ estimatedTokens: 6000 })).toBe('ovh:cloud')
    t.apple.queue({ text: 'local' })
    expect(await t.call({ estimatedTokens: 6000, onDeviceTokens: 3000 })).toBe('apple:local')
  })

  it('moves requests bigger than Groq 8K tokens/minute to OVHcloud', async () => {
    const t = setup([GROQ, OVH])
    t.ovh.queue({ text: 'big job' })
    expect(await t.call({ estimatedTokens: 9000 })).toBe('ovh:big job')
    expect(t.groq.requests).toHaveLength(0)
  })

  it('respects daily request budgets from the usage log', async () => {
    const t = setup([GROQ, OVH])
    for (let i = 0; i < 950; i++) {
      t.repos.usage.record({
        at: t.clock.nowIso(),
        provider: 'groq',
        model: GROQ.model,
        tier: 'write',
        task: 'x',
        tokensIn: 10,
        tokensOut: 10,
        latencyMs: 1,
        ok: true,
        error: null,
      })
    }
    t.ovh.queue({ text: 'overflow' })
    expect(await t.call()).toBe('ovh:overflow')
  })

  it('respects per-tier daily token budgets', async () => {
    const t = setup([GROQ], { tierTokensPerDay: { write: 1000 } })
    t.groq.fallback = { text: 'ok', usage: { inputTokens: 600, outputTokens: 300 } }
    expect(await t.call({ estimatedTokens: 50 })).toBe('groq:ok')
    await expect(t.call({ estimatedTokens: 200 })).rejects.toBeInstanceOf(BrainUnavailableError)
  })
})

describe('Router rate limiting', () => {
  it('waits on the bucket when the wait fits the deadline (OVHcloud 2 req/min)', async () => {
    const t = setup([OVH])
    t.ovh.fallback = { text: 'ok' }
    const start = t.clock.now()
    await t.call({ tier: 'reason', deadline: start + 120_000 })
    await t.call({ tier: 'reason', deadline: start + 120_000 })
    await t.call({ tier: 'reason', deadline: start + 120_000 })
    expect(t.clock.now() - start).toBe(30_000)
  })

  it('gives up instead of waiting past the deadline', async () => {
    const t = setup([OVH])
    t.ovh.fallback = { text: 'ok' }
    await t.call()
    await t.call()
    await expect(t.call({ deadline: t.clock.now() + 5000 })).rejects.toBeInstanceOf(
      BrainUnavailableError,
    )
  })

  it('updates buckets from response headers', async () => {
    const t = setup([OVH])
    t.ovh.queue({
      text: 'ok',
      headers: {
        'x-ratelimit-remaining-minute': '0',
        'x-ratelimit-limit-minute': '2',
        'ratelimit-reset': '45',
      },
    })
    await t.call()
    expect(t.router.limiter.waitMs('ovh', OVH.model, 10)).toBe(45_000)
  })
})

describe('Router deadlines, cancellation and redaction', () => {
  const real = () => {
    const groq = new FakeBackend('groq')
    const ovh = new FakeBackend('ovh')
    const router = new Router({
      backends: { groq, ovh },
      clock: systemClock,
      routes: () => [GROQ, OVH],
    })
    const plan = (ms: number, signal?: AbortSignal): CallPlan => ({
      task: 'writeStep',
      tier: 'write',
      deadline: Date.now() + ms,
      estimatedTokens: 100,
      language: 'en',
      onDeviceOk: false,
      signal,
    })
    const req = {
      system: 's',
      messages: [{ role: 'user' as const, content: 'u' }],
      output: { kind: 'text' as const },
      temperature: 0,
      maxOutputTokens: 10,
      reasoningEffort: null,
    }
    return { groq, ovh, router, plan, req }
  }

  it('rejects with BrainTimeoutError when the deadline passes mid-call', async () => {
    const t = real()
    t.groq.queue({ text: 'late', delayMs: 500 })
    const started = Date.now()
    const err = await t.router.run(t.plan(80), (a) => a.call(t.req)).catch((e) => e)
    expect(err).toBeInstanceOf(BrainTimeoutError)
    expect(Date.now() - started).toBeLessThan(400)
  })

  it('rejects with an AbortError when the caller cancels', async () => {
    const t = real()
    t.groq.queue({ text: 'late', delayMs: 500 })
    const control = new AbortController()
    setTimeout(() => control.abort(), 30)
    const err = await t.router
      .run(t.plan(5000, control.signal), (a) => a.call(t.req))
      .catch((e) => e)
    expect(err.name).toBe('AbortError')
    expect(t.ovh.requests).toHaveLength(0)
  })

  it('redacts cloud requests but not on-device ones', async () => {
    const clock = new FakeClock()
    const groq = new FakeBackend('groq', { text: 'ok' })
    const apple = new FakeBackend('apple', { text: 'ok' })
    const redact = (s: string) => s.replace(/\S+@\S+/g, '[email]')
    const make = (routes: ModelRoute[]) =>
      new Router({ backends: { groq, apple }, clock, routes: () => routes, redact })
    const req = {
      system: 'mail me at a@b.fi',
      messages: [{ role: 'user' as const, content: 'I am x@y.com' }],
      output: { kind: 'text' as const },
      temperature: 0,
      maxOutputTokens: 10,
      reasoningEffort: null,
    }
    const plan: CallPlan = {
      task: 't',
      tier: 'extract',
      deadline: clock.now() + 5000,
      estimatedTokens: 50,
      language: 'en',
      onDeviceOk: true,
    }
    await make([GROQ]).run(plan, (a) => a.call(req))
    expect(groq.requests[0]?.system).toBe('mail me at [email]')
    expect(groq.requests[0]?.messages[0]?.content).toBe('I am [email]')
    await make([APPLE]).run(plan, (a) => a.call(req))
    expect(apple.requests[0]?.messages[0]?.content).toBe('I am x@y.com')
  })
})

describe('Router streaming', () => {
  it('falls through before the first part, not after', async () => {
    const t = setup([GROQ, OVH])
    t.groq.queue({ error: new BackendError('server', 'down', { status: 502 }) })
    t.ovh.queue({ chunks: ['Hel', 'lo'] })
    const parts: string[] = []
    for await (const p of t.router.stream(t.plan({ tier: 'chat' }), {
      system: 's',
      messages: [{ role: 'user', content: 'hi' }],
      output: { kind: 'text' },
      temperature: 0.6,
      maxOutputTokens: 100,
      reasoningEffort: null,
    })) {
      if (p.type === 'text') parts.push(p.delta)
    }
    expect(parts.join('')).toBe('Hello')
    expect(
      t.repos.usage
        .rowsSince('2000-01-01')
        .map((r) => r.provider)
        .sort(),
    ).toEqual(['groq', 'ovh'])
  })
})

describe('Router follow-up calls', () => {
  it('waits for the bucket before a repair call instead of tripping a 429', async () => {
    const t = setup([OVH])
    t.ovh.fallback = { text: 'ok' }
    const start = t.clock.now()
    const out = await t.router.run(
      t.plan({ tier: 'reason', deadline: start + 120_000 }),
      async (a) => {
        const req = {
          system: 's',
          messages: [{ role: 'user' as const, content: 'u' }],
          output: { kind: 'text' as const },
          temperature: 0,
          maxOutputTokens: 10,
          reasoningEffort: null,
        }
        await a.call(req)
        await a.call(req)
        return (await a.call(req)).text // third call in a minute: must wait for OVHcloud's 2 req/min
      },
    )
    expect(out).toBe('ok')
    expect(t.clock.now() - start).toBe(30_000)
  })
})
