/** Adapters and the lifecycle: keys, follow-up de-duplication, helper signals, step ordering. */
import { FakeClock } from '@engine/clock'
import type { FollowUpService } from '@engine/contracts'
import { FakeHelper } from '@engine/helper'
import { describe, expect, it } from 'vitest'
import { helperSignals, keysWithSecrets, oncePerRoadmap } from './adapters'
import { Lifecycle } from './lifecycle'
import { memorySecrets } from './memory-secrets'

describe('keysWithSecrets', () => {
  it('prefers keys from Settings and falls back to the environment lookup', () => {
    const secrets = memorySecrets()
    const keys = keysWithSecrets(secrets, (name) =>
      name === 'OVH_AI_ENDPOINTS_TOKEN' ? 'env-ovh' : `env-${name}`,
    )
    expect(keys('GEMINI_API_KEY')).toBe('env-GEMINI_API_KEY')
    secrets.set('gemini', '  typed-in  ')
    expect(keys('GEMINI_API_KEY')).toBe('typed-in')
    expect(keys('OVH_AI_ENDPOINTS_TOKEN')).toBe('env-ovh')
    secrets.set('gemini', '')
    expect(keys('GEMINI_API_KEY')).toBe('env-GEMINI_API_KEY')
  })
})

describe('oncePerRoadmap', () => {
  it('forwards each finished roadmap once', () => {
    const seen: string[] = []
    const inner: FollowUpService = {
      start: () => {},
      stop: () => {},
      dueSummary: () => ({ count: 0, conceptIds: [] }),
      onSessionComplete: (id) => seen.push(id),
    }
    const followUps = oncePerRoadmap(inner)
    followUps.onSessionComplete('rdm_1') // StudyService on the 'done' transition
    followUps.onSessionComplete('rdm_1') // SessionFlow on the 'complete' instruction
    followUps.onSessionComplete('rdm_2')
    expect(seen).toEqual(['rdm_1', 'rdm_2'])
  })
})

describe('helperSignals', () => {
  it('reads idle time and the frontmost window from the helper; down = rejected', async () => {
    const helper = new FakeHelper({ clock: new FakeClock() })
    const signals = helperSignals(helper)
    await expect(signals.idleSeconds()).rejects.toThrow()
    await helper.start()
    helper.respond('system.idle', { seconds: 42 })
    expect(await signals.idleSeconds()).toBe(42)
    expect(await signals.frontmost()).toBeNull()
  })
})

describe('Lifecycle', () => {
  it('starts in order, stops in reverse, ignores repeats and survives a failing stop', async () => {
    const log: string[] = []
    const errors: string[] = []
    const step = (name: string, failStop = false) => ({
      name,
      start: async () => {
        log.push(`start ${name}`)
      },
      stop: () => {
        log.push(`stop ${name}`)
        if (failStop) throw new Error('boom')
      },
    })
    const lifecycle = new Lifecycle([step('a'), step('b', true), step('c')], (m) => errors.push(m))
    await Promise.all([lifecycle.start(), lifecycle.start()])
    await Promise.all([lifecycle.stop(), lifecycle.stop()])
    await lifecycle.start()
    expect(lifecycle.isRunning).toBe(true)
    expect(log).toEqual([
      'start a',
      'start b',
      'start c',
      'stop c',
      'stop b',
      'stop a',
      'start a',
      'start b',
      'start c',
    ])
    expect(errors).toEqual(['[engine] stop of b failed'])
  })

  it('stops what started when a start step fails', async () => {
    const log: string[] = []
    const lifecycle = new Lifecycle(
      [
        { name: 'a', start: () => void log.push('start a'), stop: () => void log.push('stop a') },
        {
          name: 'b',
          start: () => {
            throw new Error('no')
          },
          stop: () => void log.push('stop b'),
        },
      ],
      () => {},
    )
    await expect(lifecycle.start()).rejects.toThrow('no')
    await lifecycle.stop()
    expect(log).toEqual(['start a', 'stop b', 'stop a'])
  })
})
