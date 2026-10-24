/**
 * The real ProviderService (Settings → AI providers, AppState.ai): tests one provider end to end
 * through the brain and reports which providers look usable.
 *
 * The Brain contract has no "test this provider" call, so `test(id)` runs the cheapest real task
 * (P11 writeNudge, tier triage) on a brain whose routes contain only that provider's model
 * (`probe`; composeReal builds it with createBrain, sharing the usage log). Without a test result,
 * a cloud provider counts as usable when it has a key (OVHcloud needs none) and the on-device
 * model when the helper says it is available.
 */

import { type KeyGetter, type KeyName, resolveRoutes } from '@engine/brain'
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { HelperClient } from '@engine/contracts'
import type { Settings } from '@shared/domain'
import { type LlmTier, type ModelRoute, ProviderId } from '@shared/llm'
import type { ProviderService, ProviderTestResult } from '../services'

export interface ProviderServiceDeps {
  clock: Clock
  keys: KeyGetter
  helper: HelperClient
  settings: () => Pick<Settings, 'ai'>
  /** A brain that may only use `route`. */
  probe: (route: ModelRoute) => Pick<Brain, 'writeNudge'>
  timeoutMs?: number
}

/** Cloud providers that need a key, and its name. */
const KEY_OF: Partial<Record<ProviderId, KeyName>> = {
  gemini: 'GEMINI_API_KEY',
  groq: 'GROQ_API_KEY',
  mistral: 'MISTRAL_API_KEY',
}
const TIERS: LlmTier[] = ['triage', 'write', 'extract', 'reason', 'chat']
const TEST_TIMEOUT_MS = 15_000

/** The model a provider is tested with: its first route over the tiers (Settings overrides first). */
export function routeFor(id: ProviderId, overrides: Record<string, string>): ModelRoute | null {
  for (const tier of TIERS) {
    const route = resolveRoutes(tier, overrides).find((r) => r.provider === id)
    if (route) return route
  }
  return null
}

/** "brain task "writeNudge" unavailable: groq:openai/gpt-oss-20b: auth 401 …" → the useful part. */
export function cleanError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof Error && error.name === 'BrainTimeoutError') return 'The provider timed out'
  return message.replace(/^brain task "[^"]+" unavailable: /, '').slice(0, 300) || 'Test failed'
}

export class RealProviderService implements ProviderService {
  private readonly results = new Map<ProviderId, ProviderTestResult>()
  private onDevice: boolean | null = null

  constructor(private readonly deps: ProviderServiceDeps) {}

  async test(id: ProviderId): Promise<ProviderTestResult> {
    const result = await this.run(id)
    this.results.set(id, result)
    if (id === 'apple') this.onDevice = result.ok
    return result
  }

  status(): { ready: boolean; onDevice: boolean; providers: { id: string; ok: boolean }[] } {
    const providers = ProviderId.options.map((id) => ({ id, ok: this.usable(id) }))
    const onDevice = this.usable('apple')
    const ready = onDevice || providers.some((p) => p.ok && p.id !== 'apple')
    return { ready, onDevice, providers }
  }

  /** Asks the helper whether the on-device model is ready (at start and on reconnect). */
  async refreshOnDevice(): Promise<boolean> {
    const { helper, settings } = this.deps
    let available = false
    if (settings().ai.useOnDevice && helper.status === 'connected') {
      try {
        available = (await helper.call('llm.onDevice.status', {}, { timeoutMs: 2000 })).available
      } catch {
        available = false
      }
    }
    this.onDevice = available
    return available
  }

  private usable(id: ProviderId): boolean {
    const tested = this.results.get(id)
    if (id === 'apple') return this.deps.settings().ai.useOnDevice && this.onDevice === true
    const keyName = KEY_OF[id]
    const hasKey = keyName ? Boolean(this.deps.keys(keyName)) : true
    return hasKey && (tested?.ok ?? true)
  }

  private async run(id: ProviderId): Promise<ProviderTestResult> {
    const { clock, keys, settings } = this.deps
    const keyName = KEY_OF[id]
    if (keyName && !keys(keyName)) return { ok: false, latencyMs: null, error: 'No API key set' }
    if (id === 'apple' && !settings().ai.useOnDevice) {
      return { ok: false, latencyMs: null, error: 'The on-device model is switched off' }
    }
    const route = routeFor(id, settings().ai.modelOverrides)
    if (!route) return { ok: false, latencyMs: null, error: 'No model is configured' }
    const brain = this.deps.probe(route)
    const input = { kind: 'provider_test', facts: 'connection test from Settings', language: 'en' }
    const started = clock.now()
    try {
      await brain.writeNudge(input, { timeoutMs: this.deps.timeoutMs ?? TEST_TIMEOUT_MS })
      return { ok: true, latencyMs: Math.max(0, Math.round(clock.now() - started)), error: null }
    } catch (error) {
      return { ok: false, latencyMs: null, error: cleanError(error) }
    }
  }
}
