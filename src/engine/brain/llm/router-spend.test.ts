import type { ModelRoute } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import { FakeClock, systemClock } from '../../clock'
import type { LlmCallRecord } from '../../contracts'
import { createMemoryRepos } from '../../testing/memory-repos'
import { FakeBackend } from '../testing/fake-backend'
import { type CallPlan, Router } from './router'

const GEMINI: ModelRoute = { provider: 'gemini', model: 'gemini-3.5-flash' }
const OVH: ModelRoute = { provider: 'ovh', model: 'gpt-oss-20b' }

const req = {
  system: 'sys',
  messages: [{ role: 'user' as const, content: 'hello' }],
  output: { kind: 'text' as const },
  temperature: 0,
  maxOutputTokens: 1000,
  reasoningEffort: null,
}

/** Router over Gemini → OVHcloud with an in-memory usage log seeded with `spentOutTokens`. */
function setup(capEur: number, spentOutTokens: number) {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const fakeRow = (provider: LlmCallRecord['provider'], model: string, tokensOut: number) =>
    repos.usage.record({
      at: '2026-10-01T10:00:00.000Z',
      provider,
      model,
      tier: 'reason',
      task: 'earlier',
      tokensIn: 0,
      tokensOut,
      latencyMs: 1000,
      ok: true,
      error: null,
    })
  // gemini-3.5-flash output: $9 / 1M → €9 per 1M tokens; free OVHcloud rows cost nothing.
  if (spentOutTokens) fakeRow('gemini', GEMINI.model, spentOutTokens)
  fakeRow('ovh', OVH.model, 50_000_000)
  const gemini = new FakeBackend('gemini')
  const ovh = new FakeBackend('ovh')
  const router = new Router({
    backends: { gemini, ovh },
    clock,
    usage: repos.usage,
    routes: () => [GEMINI, OVH],
    spendCapEur: capEur,
    sleep: async (ms) => clock.advance(ms),
  })
  const plan: CallPlan = {
    task: 'test',
    tier: 'reason',
    deadline: clock.now() + 30_000,
    estimatedTokens: 2000,
    outputTokens: 1000,
    language: 'en',
    onDeviceOk: false,
  }
  const call = () =>
    router.run(plan, async (a) => `${a.route.provider}:${(await a.call(req)).text}`)
  return { clock, repos, gemini, ovh, router, plan, call }
}

describe('Router spend cap', () => {
  it('over the cap: Gemini is skipped as over-budget and OVHcloud answers', async () => {
    const t = setup(10, 1_111_000) // €9.999 spent
    t.gemini.fallback = { text: 'paid' }
    t.ovh.queue({ text: 'free' })
    const { skipped } = await t.router.candidates(t.plan)
    expect(skipped).toEqual(['gemini:gemini-3.5-flash: over-budget'])
    expect(await t.call()).toBe('ovh:free')
    expect(t.gemini.requests).toHaveLength(0)
    expect(t.router.spend.summary()).toEqual({ eur: expect.closeTo(9.999, 6), capEur: 10 })
  })

  it('under the cap: Gemini is used and its cost is added to the spend', async () => {
    const t = setup(10, 100_000) // €0.90 spent
    t.gemini.queue({ text: 'paid', usage: { inputTokens: 1000, outputTokens: 100_000 } })
    expect(await t.call()).toBe('gemini:paid')
    expect(t.ovh.requests).toHaveLength(0)
    expect(t.gemini.requests[0]?.tier).toBe('reason')
    // + 1000 × $1.50/M + 100 000 × $9/M = €0.9015
    expect(t.router.spend.summary().eur).toBeCloseTo(0.9 + 0.9015, 6)
  })

  it('counts the worst-case thinking output reported by the backend', async () => {
    const t = setup(10, 1_000_000) // €9.00 spent
    t.gemini.billableOutputTokens = (_m, _tier, max) => max + 200_000 // + €1.80 worst case
    t.ovh.queue({ text: 'free' })
    expect(await t.call()).toBe('ovh:free')
  })

  it('does not send a repair call that would pass the cap', async () => {
    const t = setup(10, 1_000_000) // €9.00
    t.gemini.queue({ text: 'first', usage: { inputTokens: 1000, outputTokens: 110_000 } }) // + €0.9915
    t.ovh.queue({ text: 'free' })
    const out = await t.router.run(t.plan, async (a) => {
      const first = await a.call(req)
      if (a.route.provider === 'gemini') await a.call(req) // the repair no longer fits
      return `${a.route.provider}:${first.text}`
    })
    expect(out).toBe('ovh:free')
    expect(t.gemini.requests).toHaveLength(1)
  })

  it('logs a timed-out paid call at its worst case, never as free', async () => {
    const gemini = new FakeBackend('gemini')
    const repos = createMemoryRepos(systemClock)
    const router = new Router({
      backends: { gemini },
      clock: systemClock,
      usage: repos.usage,
      routes: () => [GEMINI],
      spendCapEur: 10,
    })
    gemini.queue({ text: 'late', delayMs: 400 })
    const plan: CallPlan = {
      task: 'writeStep',
      tier: 'write',
      deadline: Date.now() + 150,
      estimatedTokens: 1100,
      outputTokens: 1000,
      language: 'en',
      onDeviceOk: false,
    }
    await router.run(plan, (a) => a.call(req)).catch(() => null)
    const row = repos.usage.rowsSince('1970-01-01T00:00:00.000Z')[0]
    expect(row?.failures).toBe(1)
    expect(row?.tokensOut).toBe(1000)
    expect(row?.tokensIn).toBeGreaterThan(0)
  })
})
