/**
 * Daily budgets. Per provider+model: requests/day and tokens/day from the free-tier limits (with
 * headroom), counted over a rolling 24 h window from the usage log so they survive restarts.
 * Per tier: optional token budgets per UTC day (e.g. to cap background extraction).
 */
import type { LlmTier, ProviderId, ProviderLimits } from '@shared/llm'
import type { Clock } from '../../clock'
import type { UsageRepo } from '../../contracts'

const DAY = 86_400_000

export interface DailyBudgetOptions {
  usage: UsageRepo | null
  clock: Clock
  limitsFor: (provider: ProviderId, model: string) => ProviderLimits
  /** Share of the published daily limit we allow ourselves (default 0.95). */
  headroom?: number
  tierTokensPerDay?: Partial<Record<LlmTier, number>>
}

export class DailyBudget {
  private tierDay = ''
  private readonly tierUsed = new Map<LlmTier, number>()

  constructor(private readonly opts: DailyBudgetOptions) {}

  private utcDay(): string {
    return new Date(this.opts.clock.now()).toISOString().slice(0, 10)
  }

  private rollTierDay(): void {
    const day = this.utcDay()
    if (day !== this.tierDay) {
      this.tierDay = day
      this.tierUsed.clear()
    }
  }

  /** Null when the call fits today's budgets, otherwise the reason it does not. */
  check(provider: ProviderId, model: string, tier: LlmTier, estTokens: number): string | null {
    this.rollTierDay()
    const tierCap = this.opts.tierTokensPerDay?.[tier]
    if (tierCap != null && (this.tierUsed.get(tier) ?? 0) + estTokens > tierCap) {
      return `daily ${tier} budget used up`
    }
    const usage = this.opts.usage
    if (!usage) return null
    const limits = this.opts.limitsFor(provider, model)
    if (limits.requestsPerDay == null && limits.tokensPerDay == null) return null
    const headroom = this.opts.headroom ?? 0.95
    const since = new Date(this.opts.clock.now() - DAY).toISOString()
    const used = usage.countSince(provider, model, since)
    if (limits.requestsPerDay != null && used.requests + 1 > limits.requestsPerDay * headroom) {
      return `${provider}:${model} daily request budget used up`
    }
    if (limits.tokensPerDay != null && used.tokens + estTokens > limits.tokensPerDay * headroom) {
      return `${provider}:${model} daily token budget used up`
    }
    return null
  }

  charge(tier: LlmTier, tokens: number): void {
    this.rollTierDay()
    this.tierUsed.set(tier, (this.tierUsed.get(tier) ?? 0) + tokens)
  }
}
