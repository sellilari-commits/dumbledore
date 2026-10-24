/**
 * Hard spend cap for paid providers (Gemini). Cumulative spend = every row of the persistent usage
 * log (rowsSince the epoch) priced with prices.ts, plus calls the router could not log (no usage
 * repo, or the write failed), so spend is never hidden. The cap comes from DUMBLEDORE_BUDGET_EUR
 * (default €10). The router asks `check()` before each paid call and skips the route as
 * 'over-budget' when spend + the call's worst-case cost would pass the cap — or when the log
 * cannot be read (unknown spend fails closed; free providers still work).
 */
import type { ProviderId } from '@shared/llm'
import type { UsageRepo } from '../../contracts'
import { costEur, priceOf } from './prices'

export const DEFAULT_CAP_EUR = 10
/** "A date before any use" for UsageRepo.rowsSince. */
export const EPOCH_ISO = '1970-01-01T00:00:00.000Z'

export function capFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env.DUMBLEDORE_BUDGET_EUR?.trim()
  const v = raw ? Number(raw) : Number.NaN
  return Number.isFinite(v) && v >= 0 ? v : DEFAULT_CAP_EUR
}

export interface SpendSummary {
  /** Spend so far (all time), EUR. */
  eur: number
  capEur: number
}

export class SpendTracker {
  private unlogged = 0

  constructor(
    private readonly usage: UsageRepo | null,
    readonly capEur: number,
  ) {}

  /** Logged + unlogged spend in EUR; null when the usage log cannot be read. */
  private total(): number | null {
    let logged = 0
    if (this.usage) {
      try {
        for (const r of this.usage.rowsSince(EPOCH_ISO)) {
          logged += costEur(r.provider, r.model, r.tokensIn, r.tokensOut)
        }
      } catch {
        return null
      }
    }
    return logged + this.unlogged
  }

  /** A call that could not be written to the usage log (tokensOut includes thinking tokens). */
  addUnlogged(provider: ProviderId, model: string, tokensIn: number, tokensOut: number): void {
    this.unlogged += costEur(provider, model, tokensIn, tokensOut)
  }

  /** Null when the call is free or fits under the cap, else 'over-budget'. */
  check(provider: ProviderId, model: string, tokensIn: number, tokensOut: number): string | null {
    if (!priceOf(provider, model)) return null
    const spent = this.total()
    if (spent === null) return 'over-budget'
    return spent + costEur(provider, model, tokensIn, tokensOut) > this.capEur
      ? 'over-budget'
      : null
  }

  summary(): SpendSummary {
    return { eur: this.total() ?? this.unlogged, capEur: this.capEur }
  }
}
