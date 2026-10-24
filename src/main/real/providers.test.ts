/**
 * RealProviderService: provider tests through a single-route brain, key checks, error cleanup,
 * the on-device status from the helper and the AppState summary.
 */

import type { KeyName } from '@engine/brain'
import type { Brain } from '@engine/brain-contract'
import { BrainTimeoutError, BrainUnavailableError } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import { FakeHelper } from '@engine/helper'
import { DEFAULT_SETTINGS, type Settings } from '@shared/domain'
import type { ModelRoute } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import { cleanError, RealProviderService, routeFor } from './providers'

function setup(
  opts: { keys?: Partial<Record<KeyName, string>>; fail?: Error; settings?: Settings } = {},
) {
  const clock = new FakeClock()
  const helper = new FakeHelper({ clock })
  const routes: ModelRoute[] = []
  const settings = opts.settings ?? DEFAULT_SETTINGS
  const service = new RealProviderService({
    clock,
    helper,
    keys: (name) => opts.keys?.[name],
    settings: () => settings,
    probe: (route) => {
      routes.push(route)
      const writeNudge: Brain['writeNudge'] = async () => {
        clock.advance(420)
        if (opts.fail) throw opts.fail
        return { title: 'Hi', body: 'All good.' }
      }
      return { writeNudge }
    },
  })
  return { clock, helper, routes, service }
}

describe('RealProviderService', () => {
  it('tests a provider with its own model only and reports the latency', async () => {
    const { service, routes } = setup({ keys: { GEMINI_API_KEY: 'k' } })
    expect(await service.test('gemini')).toEqual({ ok: true, latencyMs: 420, error: null })
    expect(routes).toEqual([{ provider: 'gemini', model: 'gemini-3.5-flash-lite' }])
    expect(await service.test('ovh')).toMatchObject({ ok: true })
    expect(routes[1]?.provider).toBe('ovh')
  })

  it('needs a key for Gemini, Groq and Mistral but not for OVHcloud', async () => {
    const { service, routes } = setup()
    expect(await service.test('groq')).toEqual({
      ok: false,
      latencyMs: null,
      error: 'No API key set',
    })
    expect(routes).toEqual([])
    expect(service.status().providers).toEqual([
      { id: 'gemini', ok: false },
      { id: 'apple', ok: false },
      { id: 'groq', ok: false },
      { id: 'ovh', ok: true },
      { id: 'mistral', ok: false },
    ])
    expect(service.status()).toMatchObject({ ready: true, onDevice: false })
  })

  it('keeps a failed test until the next one and cleans up the error', async () => {
    const error = new BrainUnavailableError(
      'writeNudge',
      'groq:openai/gpt-oss-20b: auth 401 invalid key',
    )
    const { service } = setup({ keys: { GROQ_API_KEY: 'bad' }, fail: error })
    expect(await service.test('groq')).toEqual({
      ok: false,
      latencyMs: null,
      error: 'groq:openai/gpt-oss-20b: auth 401 invalid key',
    })
    expect(service.status().providers.find((p) => p.id === 'groq')?.ok).toBe(false)
    expect(cleanError(new BrainTimeoutError('writeNudge'))).toBe('The provider timed out')
  })

  it('follows Settings model overrides', () => {
    expect(routeFor('groq', { triage: 'groq:llama-4-scout' })).toEqual({
      provider: 'groq',
      model: 'llama-4-scout',
    })
    expect(routeFor('mistral', {})?.provider).toBe('mistral')
  })

  it('asks the helper whether the on-device model is ready', async () => {
    const { service, helper } = setup()
    expect(await service.refreshOnDevice()).toBe(false) // helper not connected yet
    await helper.start()
    helper.respond('llm.onDevice.status', { available: true, reason: null, contextSize: 4096 })
    expect(await service.refreshOnDevice()).toBe(true)
    expect(service.status()).toMatchObject({ ready: true, onDevice: true })
    expect(service.status().providers.find((p) => p.id === 'apple')?.ok).toBe(true)
  })

  it('treats the on-device model as off when Settings switch it off', async () => {
    const settings = { ...DEFAULT_SETTINGS, ai: { ...DEFAULT_SETTINGS.ai, useOnDevice: false } }
    const { service, helper } = setup({ settings })
    await helper.start()
    helper.respond('llm.onDevice.status', { available: true, reason: null, contextSize: 4096 })
    expect(await service.refreshOnDevice()).toBe(false)
    expect(await service.test('apple')).toMatchObject({
      ok: false,
      error: 'The on-device model is switched off',
    })
  })
})
