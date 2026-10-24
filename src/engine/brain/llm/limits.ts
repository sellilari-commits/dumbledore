/**
 * Per provider+model rate limiting: continuous-refill token buckets for requests/minute and
 * tokens/minute (capacities from PROVIDER_LIMITS, corrected by live rate-limit headers),
 * cooldowns after 429s, Groq's daily request counter from its headers, and an in-flight cap
 * (the on-device model runs one request at a time).
 */
import type { ProviderId, ProviderLimits } from '@shared/llm'
import type { Clock } from '../../clock'

interface Bucket {
  capacity: number
  level: number
  updatedAt: number
}

interface ModelState {
  rpm: Bucket | null
  tpm: Bucket | null
  blockedUntil: number
  dayRemaining: number | null
  dayResetAt: number
  inFlight: number
  maxInFlight: number
}

const MINUTE = 60_000

/** "2m59.56s" | "7.66s" | "120ms" | "1h2m" | "30" (seconds) → ms; null when unparseable. */
export function parseDuration(value: string | undefined): number | null {
  if (value == null) return null
  const v = value.trim()
  if (/^\d+(\.\d+)?$/.test(v)) return Math.round(Number(v) * 1000)
  const re = /(\d+(?:\.\d+)?)(ms|h|m|s)/g
  let total = 0
  let matched = false
  for (const m of v.matchAll(re)) {
    matched = true
    const n = Number(m[1])
    const unit = m[2]
    total += unit === 'ms' ? n : unit === 's' ? n * 1000 : unit === 'm' ? n * MINUTE : n * 3_600_000
  }
  return matched ? Math.round(total) : null
}

function num(value: string | undefined): number | null {
  if (value == null || value.trim() === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export class RateLimiter {
  private readonly states = new Map<string, ModelState>()

  constructor(
    private readonly clock: Clock,
    private readonly limitsFor: (provider: ProviderId, model: string) => ProviderLimits,
  ) {}

  private state(provider: ProviderId, model: string): ModelState {
    const key = `${provider}:${model}`
    let s = this.states.get(key)
    if (!s) {
      const l = this.limitsFor(provider, model)
      const now = this.clock.now()
      const bucket = (cap: number | null): Bucket | null =>
        cap == null ? null : { capacity: cap, level: cap, updatedAt: now }
      s = {
        rpm: bucket(l.requestsPerMinute),
        tpm: bucket(l.tokensPerMinute),
        blockedUntil: 0,
        dayRemaining: null,
        dayResetAt: 0,
        inFlight: 0,
        maxInFlight: provider === 'apple' ? 1 : Number.POSITIVE_INFINITY,
      }
      this.states.set(key, s)
    }
    return s
  }

  private refill(b: Bucket | null): void {
    if (!b) return
    const now = this.clock.now()
    const elapsed = now - b.updatedAt
    if (elapsed > 0) {
      b.level = Math.min(b.capacity, b.level + (elapsed * b.capacity) / MINUTE)
      b.updatedAt = now
    }
  }

  /** False when a request of this size can never pass the tokens/minute bucket. */
  fits(provider: ProviderId, model: string, tokens: number): boolean {
    const s = this.state(provider, model)
    return !s.tpm || tokens <= s.tpm.capacity
  }

  /** Milliseconds until a request of `tokens` may start (0 = now; Infinity = never fits). */
  waitMs(provider: ProviderId, model: string, tokens: number): number {
    const s = this.state(provider, model)
    const now = this.clock.now()
    if (!this.fits(provider, model, tokens)) return Number.POSITIVE_INFINITY
    let wait = Math.max(0, s.blockedUntil - now)
    if (s.dayRemaining !== null && s.dayRemaining <= 0) {
      if (s.dayResetAt > now) wait = Math.max(wait, s.dayResetAt - now)
      else s.dayRemaining = null
    }
    if (s.inFlight >= s.maxInFlight) wait = Math.max(wait, 250)
    for (const [b, need] of [
      [s.rpm, 1],
      [s.tpm, tokens],
    ] as const) {
      if (!b) continue
      this.refill(b)
      if (b.level < need) wait = Math.max(wait, Math.ceil(((need - b.level) * MINUTE) / b.capacity))
    }
    return wait
  }

  /** Takes capacity for a request that is starting now. */
  take(provider: ProviderId, model: string, tokens: number): void {
    const s = this.state(provider, model)
    this.refill(s.rpm)
    this.refill(s.tpm)
    if (s.rpm) s.rpm.level -= 1
    if (s.tpm) s.tpm.level -= tokens
    if (s.dayRemaining !== null) s.dayRemaining -= 1
    s.inFlight++
  }

  /** Request finished: release the in-flight slot and correct the token estimate. */
  settle(provider: ProviderId, model: string, estimated: number, actual: number | null): void {
    const s = this.state(provider, model)
    s.inFlight = Math.max(0, s.inFlight - 1)
    if (s.tpm && actual != null) {
      this.refill(s.tpm)
      s.tpm.level = Math.min(s.tpm.capacity, s.tpm.level + estimated - actual)
    }
  }

  cooldown(provider: ProviderId, model: string, ms: number): void {
    const s = this.state(provider, model)
    s.blockedUntil = Math.max(s.blockedUntil, this.clock.now() + ms)
  }

  /** Applies live rate-limit headers (Groq: requests = per day, tokens = per minute; OVHcloud: per minute). */
  observe(provider: ProviderId, model: string, headers: Record<string, string>): void {
    const s = this.state(provider, model)
    const now = this.clock.now()
    const h = (k: string) => headers[k]

    const tokLimit = num(h('x-ratelimit-limit-tokens') ?? h('x-ratelimit-limit-tokens-minute'))
    const tokLeft = num(
      h('x-ratelimit-remaining-tokens') ?? h('x-ratelimit-remaining-tokens-minute'),
    )
    if (tokLimit != null || tokLeft != null) {
      this.refill(s.tpm)
      if (!s.tpm && tokLimit != null)
        s.tpm = { capacity: tokLimit, level: tokLimit, updatedAt: now }
      if (s.tpm && tokLimit != null) s.tpm.capacity = tokLimit
      if (s.tpm && tokLeft != null) s.tpm.level = Math.min(s.tpm.level, tokLeft)
    }

    const minuteLimit = num(h('x-ratelimit-limit-minute') ?? h('x-ratelimit-limit-req-minute'))
    const minuteLeft = num(
      h('x-ratelimit-remaining-minute') ?? h('x-ratelimit-remaining-req-minute'),
    )
    if (minuteLimit != null || minuteLeft != null) {
      this.refill(s.rpm)
      if (!s.rpm && minuteLimit != null)
        s.rpm = { capacity: minuteLimit, level: minuteLimit, updatedAt: now }
      if (s.rpm && minuteLimit != null) s.rpm.capacity = minuteLimit
      if (s.rpm && minuteLeft != null) s.rpm.level = Math.min(s.rpm.level, minuteLeft)
      if (minuteLeft === 0) {
        const reset = parseDuration(h('ratelimit-reset')) ?? MINUTE
        s.blockedUntil = Math.max(s.blockedUntil, now + reset)
      }
    }

    if (provider === 'groq') {
      const dayLeft = num(h('x-ratelimit-remaining-requests'))
      if (dayLeft != null) {
        s.dayRemaining = dayLeft
        s.dayResetAt = now + (parseDuration(h('x-ratelimit-reset-requests')) ?? MINUTE)
      }
    }

    const retryAfter = parseDuration(h('retry-after'))
    if (retryAfter != null && retryAfter > 0)
      s.blockedUntil = Math.max(s.blockedUntil, now + retryAfter)
  }
}
