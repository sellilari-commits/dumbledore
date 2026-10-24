import { PROVIDER_LIMITS } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { parseDuration, RateLimiter } from './limits'

const make = () => {
  const clock = new FakeClock()
  const limiter = new RateLimiter(clock, (p) => PROVIDER_LIMITS[p])
  return { clock, limiter }
}

describe('parseDuration', () => {
  it('parses Groq/OVH styles', () => {
    expect(parseDuration('7.66s')).toBe(7660)
    expect(parseDuration('2m59.56s')).toBe(179_560)
    expect(parseDuration('120ms')).toBe(120)
    expect(parseDuration('30')).toBe(30_000)
    expect(parseDuration('1h')).toBe(3_600_000)
    expect(parseDuration('soon')).toBeNull()
    expect(parseDuration(undefined)).toBeNull()
  })
})

describe('RateLimiter', () => {
  it('enforces OVHcloud 2 requests/minute with continuous refill', () => {
    const { clock, limiter } = make()
    expect(limiter.waitMs('ovh', 'gpt-oss-20b', 500)).toBe(0)
    limiter.take('ovh', 'gpt-oss-20b', 500)
    limiter.take('ovh', 'gpt-oss-20b', 500)
    const wait = limiter.waitMs('ovh', 'gpt-oss-20b', 500)
    expect(wait).toBe(30_000)
    clock.advance(30_000)
    expect(limiter.waitMs('ovh', 'gpt-oss-20b', 500)).toBe(0)
    // per model: another model is unaffected
    expect(limiter.waitMs('ovh', 'gpt-oss-120b', 500)).toBe(0)
  })

  it('knows when a request can never pass Groq 8K tokens/minute', () => {
    const { limiter } = make()
    expect(limiter.fits('groq', 'openai/gpt-oss-120b', 7000)).toBe(true)
    expect(limiter.fits('groq', 'openai/gpt-oss-120b', 9000)).toBe(false)
    expect(limiter.waitMs('groq', 'openai/gpt-oss-120b', 9000)).toBe(Number.POSITIVE_INFINITY)
    expect(limiter.fits('ovh', 'gpt-oss-120b', 50_000)).toBe(true)
  })

  it('waits for tokens/minute and refunds over-estimates on settle', () => {
    const { limiter } = make()
    limiter.take('groq', 'm', 6000)
    expect(limiter.waitMs('groq', 'm', 4000)).toBeGreaterThan(0)
    limiter.settle('groq', 'm', 6000, 1000) // actual use was much lower
    expect(limiter.waitMs('groq', 'm', 4000)).toBe(0)
  })

  it('applies Groq headers: remaining tokens and the daily request counter', () => {
    const { limiter } = make()
    limiter.observe('groq', 'm', {
      'x-ratelimit-limit-tokens': '8000',
      'x-ratelimit-remaining-tokens': '500',
      'x-ratelimit-reset-tokens': '50s',
      'x-ratelimit-remaining-requests': '0',
      'x-ratelimit-reset-requests': '2m0s',
    })
    expect(limiter.waitMs('groq', 'm', 100)).toBeGreaterThanOrEqual(119_000)
  })

  it('blocks OVHcloud when its minute counter hits zero and honours retry-after', () => {
    const { clock, limiter } = make()
    limiter.observe('ovh', 'x', {
      'x-ratelimit-limit-minute': '2',
      'x-ratelimit-remaining-minute': '0',
      'ratelimit-reset': '40',
    })
    expect(limiter.waitMs('ovh', 'x', 10)).toBe(40_000)
    clock.advance(40_000)
    limiter.observe('ovh', 'y', { 'retry-after': '5' })
    expect(limiter.waitMs('ovh', 'y', 10)).toBe(5000)
  })

  it('runs one on-device request at a time', () => {
    const { limiter } = make()
    limiter.take('apple', 'system', 1000)
    expect(limiter.waitMs('apple', 'system', 1000)).toBeGreaterThan(0)
    limiter.settle('apple', 'system', 1000, 900)
    expect(limiter.waitMs('apple', 'system', 1000)).toBe(0)
  })

  it('cooldown delays the next request', () => {
    const { clock, limiter } = make()
    limiter.cooldown('groq', 'm', 2000)
    expect(limiter.waitMs('groq', 'm', 10)).toBe(2000)
    clock.advance(2000)
    expect(limiter.waitMs('groq', 'm', 10)).toBe(0)
  })
})
