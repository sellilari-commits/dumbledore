import { describe, expect, it } from 'vitest'
import type { UsageRepo } from '../../contracts'
import { costEur, priceOf, UNKNOWN_PAID } from './prices'
import { capFromEnv, DEFAULT_CAP_EUR, SpendTracker } from './spend'

type Row = ReturnType<UsageRepo['rowsSince']>[number]

const repo = (rows: Row[], fail = false): UsageRepo => ({
  record: () => {},
  rowsSince: () => {
    if (fail) throw new Error('db locked')
    return rows
  },
  countSince: () => ({ requests: 0, tokens: 0 }),
})

const row = (provider: string, model: string, tokensIn: number, tokensOut: number): Row => ({
  provider,
  model,
  calls: 1,
  failures: 0,
  tokensIn,
  tokensOut,
})

describe('prices', () => {
  it('prices Gemini per 1M tokens (EUR = USD) and free providers at 0', () => {
    expect(costEur('gemini', 'gemini-3.5-flash-lite', 1_000_000, 1_000_000)).toBeCloseTo(2.8)
    expect(costEur('gemini', 'gemini-3.5-flash', 1_000_000, 0)).toBeCloseTo(1.5)
    expect(costEur('gemini', 'models/gemini-3.5-flash', 0, 1_000_000)).toBeCloseTo(9)
    expect(priceOf('gemini', 'gemini-9-ultra')).toEqual(UNKNOWN_PAID)
    for (const p of ['ovh', 'apple', 'groq', 'mistral'])
      expect(costEur(p, 'any', 5_000_000, 5_000_000)).toBe(0)
  })
})

describe('capFromEnv', () => {
  it('reads DUMBLEDORE_BUDGET_EUR, defaulting to 10', () => {
    expect(capFromEnv({})).toBe(DEFAULT_CAP_EUR)
    expect(capFromEnv({ DUMBLEDORE_BUDGET_EUR: '2.5' })).toBe(2.5)
    expect(capFromEnv({ DUMBLEDORE_BUDGET_EUR: 'lots' })).toBe(DEFAULT_CAP_EUR)
    expect(capFromEnv({ DUMBLEDORE_BUDGET_EUR: '-1' })).toBe(DEFAULT_CAP_EUR)
    expect(capFromEnv({ DUMBLEDORE_BUDGET_EUR: '0' })).toBe(0)
  })
})

describe('SpendTracker', () => {
  it('sums every usage-log row plus unlogged calls', () => {
    const t = new SpendTracker(
      repo([
        row('gemini', 'gemini-3.5-flash', 1_000_000, 100_000),
        row('ovh', 'gpt-oss-20b', 9e6, 9e6),
      ]),
      10,
    )
    expect(t.summary().eur).toBeCloseTo(2.4)
    t.addUnlogged('gemini', 'gemini-3.5-flash-lite', 0, 1_000_000)
    expect(t.summary()).toEqual({ eur: expect.closeTo(4.9, 6), capEur: 10 })
  })

  it('blocks a paid call that would pass the cap, never a free one', () => {
    // spent €9.00; cap €9.02
    const t = new SpendTracker(repo([row('gemini', 'gemini-3.5-flash', 0, 1_000_000)]), 9.02)
    expect(t.check('gemini', 'gemini-3.5-flash', 1000, 1000)).toBeNull() // + €0.0105
    expect(t.check('gemini', 'gemini-3.5-flash', 10_000, 10_000)).toBe('over-budget') // + €0.105
    expect(t.check('ovh', 'gpt-oss-120b', 1e9, 1e9)).toBeNull()
  })

  it('fails closed when the usage log cannot be read', () => {
    const t = new SpendTracker(repo([], true), 10)
    expect(t.check('gemini', 'gemini-3.5-flash-lite', 10, 10)).toBe('over-budget')
    expect(t.check('apple', 'system', 10, 10)).toBeNull()
  })
})
