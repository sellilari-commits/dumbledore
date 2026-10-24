import { describe, expect, it } from 'vitest'
import { brainHarness, R } from './testing/harness'

describe('brain.spend()', () => {
  it('prices the usage log (Gemini only) against the cap', () => {
    const t = brainHarness([R.gemini, R.ovh], { spendCapEur: 2 })
    const base = {
      at: '2026-10-20T10:00:00.000Z',
      tier: 'reason' as const,
      task: 'buildRoadmap',
      latencyMs: 900,
      ok: true,
      error: null,
    }
    t.repos.usage.record({
      ...base,
      provider: 'gemini',
      model: 'gemini-3.5-flash',
      tokensIn: 100_000,
      tokensOut: 50_000,
    })
    t.repos.usage.record({
      ...base,
      provider: 'ovh',
      model: 'gpt-oss-120b',
      tokensIn: 9e6,
      tokensOut: 9e6,
    })
    // 100 000 × $1.50/M + 50 000 × $9/M = €0.60; OVHcloud is free
    expect(t.brain.spend()).toEqual({ eur: expect.closeTo(0.6, 6), capEur: 2 })
  })
})
