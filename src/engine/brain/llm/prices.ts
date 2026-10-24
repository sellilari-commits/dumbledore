/**
 * LLM prices for the spend cap, in USD per 1M tokens, charged as EUR at 1:1 (overestimates: the
 * safe side). Output prices include thinking tokens. Only Gemini (paid key) costs money; OVHcloud
 * (keyless), Apple on-device and the Groq / Mistral free tiers cost 0.
 *
 * Checked 2026-10-24 against ai.google.dev/gemini-api/docs/pricing (paid tier, Standard):
 * - gemini-3.5-flash-lite: $0.30 in / $2.50 out — verified on Google's page.
 * - gemini-3.5-flash: not on Google's page any more; $1.50 / $9.00 from third-party price lists,
 *   kept as a conservative (high) value — UNVERIFIED.
 * - gemini-3.6-flash, gemini-3.8-flash: $0.75 / $3.75 until 2026-12-31, then $1.50 / $7.50; we use
 *   the 2027 price.
 * Any other Gemini model (e.g. a Settings override) is priced at UNKNOWN_PAID, deliberately high.
 */
import type { ProviderId } from '@shared/llm'

export interface Price {
  inputPerM: number
  outputPerM: number
  verified: boolean
}

export const USD_TO_EUR = 1

export const PAID_PROVIDERS: ReadonlySet<ProviderId> = new Set<ProviderId>(['gemini'])

export const PRICES_USD: Record<string, Price> = {
  'gemini-3.5-flash-lite': { inputPerM: 0.3, outputPerM: 2.5, verified: true },
  'gemini-3.5-flash': { inputPerM: 1.5, outputPerM: 9, verified: false },
  'gemini-3.6-flash': { inputPerM: 1.5, outputPerM: 7.5, verified: true },
  'gemini-3.8-flash': { inputPerM: 1.5, outputPerM: 7.5, verified: true },
}

/** Price for paid models missing from the table (above every Flash model we know of). */
export const UNKNOWN_PAID: Price = { inputPerM: 5, outputPerM: 30, verified: false }

/** Null for free providers. */
export function priceOf(provider: ProviderId | string, model: string): Price | null {
  if (!PAID_PROVIDERS.has(provider as ProviderId)) return null
  const id = model
    .trim()
    .toLowerCase()
    .replace(/^models\//, '')
  return PRICES_USD[id] ?? UNKNOWN_PAID
}

export function costEur(
  provider: ProviderId | string,
  model: string,
  tokensIn: number,
  tokensOut: number,
): number {
  const p = priceOf(provider, model)
  if (!p) return 0
  return ((tokensIn * p.inputPerM + tokensOut * p.outputPerM) / 1_000_000) * USD_TO_EUR
}

/** "€0.0123" — enough digits for eval-sized amounts. */
export function formatEur(eur: number): string {
  return `€${eur < 1 ? eur.toFixed(4) : eur.toFixed(2)}`
}
