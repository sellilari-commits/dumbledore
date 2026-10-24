/**
 * Daily budget guard for extraction calls (docs/PLAN.md §6.4 "daily budget guard"): caps calls
 * and estimated tokens per local day so passive capture can never eat the free LLM tiers that
 * study sessions need. The LLM router keeps its own per-provider limits on top of this.
 */

export interface BudgetLimits {
  maxCalls: number
  maxTokens: number
}

export class DailyBudget {
  private day = ''
  private calls = 0
  private tokens = 0

  constructor(private readonly limits: BudgetLimits) {}

  canSpend(tokens: number, at: number): boolean {
    this.rollover(at)
    return this.calls < this.limits.maxCalls && this.tokens + tokens <= this.limits.maxTokens
  }

  spend(tokens: number, at: number): void {
    this.rollover(at)
    this.calls++
    this.tokens += tokens
  }

  left(at: number): { calls: number; tokens: number } {
    this.rollover(at)
    return {
      calls: Math.max(0, this.limits.maxCalls - this.calls),
      tokens: Math.max(0, this.limits.maxTokens - this.tokens),
    }
  }

  private rollover(at: number): void {
    const d = new Date(at)
    const day = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
    if (day === this.day) return
    this.day = day
    this.calls = 0
    this.tokens = 0
  }
}

/** Rough token estimate (≈ 4 characters per token for English, a bit more for Finnish). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}
