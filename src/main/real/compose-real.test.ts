/**
 * composeReal itself: data folder, lifecycle (idempotent, ordered, restartable), the default
 * socket helper, event bridging without duplicate session events, and the real Brain on fake
 * backends — usage logged in SQLite across restarts and the Gemini spend cap read from it.
 */
import { existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { FakeBackend } from '@engine/brain/testing/fake-backend'
import { FakeClock } from '@engine/clock'
import { SocketHelperClient } from '@engine/helper'
import type { ProviderId } from '@shared/llm'
import type { SessionState } from '@shared/state'
import { afterEach, describe, expect, it } from 'vitest'
import { composeReal } from './compose-real'
import {
  CHATGPT,
  createRig,
  disposeRig,
  localNoon,
  type Rig,
  runFor,
  tempDataDir,
} from './test-kit'

const noNetwork = async (): Promise<Response> => {
  throw new Error('network is off in tests')
}

function fakeBackends() {
  const reply = { json: { title: 'Quick check', body: 'Two minutes on the Calvin cycle?' } }
  const all = Object.fromEntries(
    (['gemini', 'apple', 'groq', 'ovh', 'mistral'] as ProviderId[]).map((id) => {
      const backend = new FakeBackend(id)
      backend.fallback = reply
      return [id, backend]
    }),
  ) as Record<ProviderId, FakeBackend>
  all.apple.available = { ok: false, reason: 'not in tests' }
  return all
}

const nudgeInput = { kind: 'review_due', facts: 'due=2; concepts=Calvin cycle', language: 'en' }

describe('composeReal', () => {
  const rigs: Rig[] = []
  const dirs: string[] = []
  afterEach(async () => {
    for (const rig of rigs.splice(0)) await disposeRig(rig)
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
  })

  it('opens the SQLite store in the data folder and exposes no fakes', async () => {
    const rig = createRig()
    rigs.push(rig)
    const { comp } = rig
    expect(comp.fakes).toEqual({ helper: null, perception: null })
    expect(comp.engine.paths.root).toBe(rig.dir)
    expect(existsSync(join(rig.dir, 'dumbledore.db'))).toBe(true)
    expect(existsSync(join(rig.dir, 'memory'))).toBe(true)
    expect(comp.engine.paths.helperSocket).toBe(join(rig.dir, 'run', 'helper.sock'))
  })

  it('takes the data folder from DUMBLEDORE_DATA_DIR and builds the socket helper by default', async () => {
    const dir = tempDataDir()
    dirs.push(dir)
    const comp = composeReal({
      clock: new FakeClock(localNoon()),
      env: { DUMBLEDORE_DATA_DIR: dir, DUMBLEDORE_HELPER: 'external' },
      keys: () => undefined,
      log: () => {},
    })
    try {
      expect(comp.engine.paths.dbFile).toBe(join(dir, 'dumbledore.db'))
      expect(comp.services.helper).toBeInstanceOf(SocketHelperClient)
      expect(comp.services.helper.status).toBe('down') // never started: no helper binary in tests
      expect(comp.engine.brain?.spend().capEur).toBe(10)
    } finally {
      await comp.close()
    }
  })

  it('starts and stops everything once, in order, and can start again', async () => {
    const rig = createRig()
    rigs.push(rig)
    const { services, helper, clock, comp, screen } = rig
    screen.show(CHATGPT)
    expect(helper.status).toBe('down')
    await Promise.all([services.start(), services.start()])
    expect(helper.status).toBe('connected')
    expect(comp.engine.mirror()).not.toBeNull()
    await runFor(clock, 3000)
    expect(services.perception.isActive()).toBe(true)
    expect(services.perception.aiChat()?.key).toBe('chatgpt')

    await services.stop()
    await services.stop()
    expect(helper.status).toBe('down')
    expect(services.perception.isActive()).toBe(false)
    expect(comp.engine.mirror()).toBeNull()
    const calls = helper.calls.length
    await runFor(clock, 10_000)
    expect(helper.calls.length).toBe(calls) // nothing polls while stopped

    await services.start()
    await runFor(clock, 3000)
    expect(helper.status).toBe('connected')
    expect(services.perception.isActive()).toBe(true)
  })

  it('forwards helper events onto the bus and announces each session change once', async () => {
    const rig = createRig()
    rigs.push(rig)
    const { services, helper, screen, clock } = rig
    const statuses: string[] = []
    const viaBus: (SessionState | null)[] = []
    const viaListener: (SessionState | null)[] = []
    services.bus.on('helper:status', ({ status }) => statuses.push(status))
    services.bus.on('session:changed', ({ session }) => viaBus.push(session))
    services.study.onChange((session) => viaListener.push(session))
    const keys: string[] = []
    services.bus.on('helper:key', ({ gesture }) => keys.push(gesture))

    screen.show(CHATGPT)
    await services.start()
    helper.emit('key.trigger', { gesture: 'tap', key: 'rightOption', secureInput: false })
    expect(statuses).toContain('connected')
    expect(keys).toEqual(['tap'])

    await runFor(clock, 3000)
    const subject = services.subjects.create({
      name: 'Algebra',
      emoji: null,
      goal: 'Quadratics',
      deadline: null,
    })
    const ctx = { assistant: 'ChatGPT', chatExcerpt: '', pageContext: '' }
    await services.study.start({ subjectId: subject.id, goal: null, question: null }, ctx)
    await services.study.next(ctx)
    expect(viaListener.length).toBeGreaterThanOrEqual(3)
    expect(viaBus).toEqual(viaListener)
  })

  it('logs brain calls in the SQLite usage log and keeps them across a restart', async () => {
    const backends = fakeBackends()
    const brainDeps = { backends, fetch: noNetwork }
    const first = createRig({ brain: undefined, compose: { brain: undefined, brainDeps } })
    rigs.push(first)
    const brain = first.comp.engine.brain
    expect(brain).not.toBeNull()
    await brain?.writeNudge(nudgeInput)
    expect(backends.gemini.requests).toHaveLength(1)
    expect(first.services.queries.usage().rows).toEqual([
      expect.objectContaining({ provider: 'gemini', model: 'gemini-3.5-flash-lite', calls: 1 }),
    ])
    await first.comp.close()

    const second = createRig({
      dir: first.dir,
      clock: first.clock,
      compose: { brain: undefined, brainDeps },
    })
    rigs.push(second)
    expect(second.services.queries.usage().rows).toEqual([
      expect.objectContaining({ provider: 'gemini', model: 'gemini-3.5-flash-lite', calls: 1 }),
    ])
    expect(second.comp.engine.brain?.spend().eur).toBeGreaterThan(0)
  })

  it('routes away from Gemini once the logged spend passes the cap, also after a restart', async () => {
    const backends = fakeBackends()
    const brainDeps = { backends, fetch: noNetwork }
    const first = createRig({ compose: { brain: undefined, brainDeps, spendCapEur: 10 } })
    rigs.push(first)
    first.services.repos.usage.record({
      at: first.clock.nowIso(),
      provider: 'gemini',
      model: 'gemini-3.5-flash-lite',
      tier: 'extract',
      task: 'extract',
      tokensIn: 40_000_000, // €12 at $0.30 / 1M input tokens
      tokensOut: 0,
      latencyMs: 900,
      ok: true,
      error: null,
    })
    await first.comp.close()

    const second = createRig({
      dir: first.dir,
      clock: first.clock,
      compose: { brain: undefined, brainDeps, spendCapEur: 10 },
    })
    rigs.push(second)
    const brain = second.comp.engine.brain
    expect(brain?.spend().eur).toBeGreaterThan(10)
    await brain?.writeNudge(nudgeInput)
    expect(backends.gemini.requests).toHaveLength(0)
    expect(backends.ovh.requests).toHaveLength(1)
  })
})
