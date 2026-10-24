/**
 * Route lists per tier: DEFAULT_ROUTES, then Settings overrides in front ("tier" →
 * "provider:model[,provider:model…]"), then extra keyless OVHcloud fallbacks (its 2 requests/min
 * limit is per model, so more models = more headroom when Groq has no key or is saturated).
 */
import { DEFAULT_ROUTES, type LlmTier, type ModelRoute, ProviderId } from '@shared/llm'

/** Verified against OVHcloud GET /v1/models on 2026-10-24. */
export const EXTRA_FALLBACKS: Record<LlmTier, ModelRoute[]> = {
  triage: [{ provider: 'ovh', model: 'gpt-oss-120b' }],
  extract: [{ provider: 'ovh', model: 'gpt-oss-120b' }],
  reason: [{ provider: 'ovh', model: 'gpt-oss-20b' }],
  write: [{ provider: 'ovh', model: 'gpt-oss-120b' }],
  chat: [{ provider: 'ovh', model: 'gpt-oss-20b' }],
}

/** "groq:openai/gpt-oss-120b, ovh:gpt-oss-20b" → routes (unknown providers are ignored). */
export function parseRouteList(spec: string): ModelRoute[] {
  return spec
    .split(',')
    .map((part) => part.trim())
    .flatMap((part) => {
      const i = part.indexOf(':')
      if (i <= 0) return []
      const provider = ProviderId.safeParse(part.slice(0, i).trim())
      const model = part.slice(i + 1).trim()
      return provider.success && model ? [{ provider: provider.data, model }] : []
    })
}

export function resolveRoutes(
  tier: LlmTier,
  overrides: Record<string, string> | null | undefined,
  extra: Record<LlmTier, ModelRoute[]> = EXTRA_FALLBACKS,
): ModelRoute[] {
  const first = overrides?.[tier] ? parseRouteList(overrides[tier] as string) : []
  const all = [...first, ...DEFAULT_ROUTES[tier], ...extra[tier]]
  const seen = new Set<string>()
  return all.filter((r) => {
    const key = `${r.provider}:${r.model}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
