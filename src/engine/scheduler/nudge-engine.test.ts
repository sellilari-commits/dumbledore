import { FakeBrain } from '@engine/testing/fake-brain'
import type { Nudge } from '@shared/domain'
import type { Toast } from '@shared/state'
import { describe, expect, it, vi } from 'vitest'
import { HOUR_MS, MINUTE_MS } from './local-time'
import type { NudgeCandidate } from './nudge-common'
import { createNudgeEngine } from './nudge-engine'
import type { Receptivity } from './receptivity'
import { shown, studentWorld } from './scheduler-fixtures'

const atBreak: Receptivity = { receptive: true, score: 1, blockers: [], breaks: ['returned'] }
const noBreak: Receptivity = { receptive: false, score: 0, blockers: [], breaks: [] }
const typing: Receptivity = {
  receptive: false,
  score: 0,
  blockers: ['typing'],
  breaks: ['returned'],
}

const cand = (patch: Partial<NudgeCandidate> = {}): NudgeCandidate => ({
  kind: 'review_due',
  dedupeKey: 'review:2026-10-24',
  value: 0.8,
  facts: 'due=1; concepts=SN1',
  fallback: { title: '1 review due', body: 'Quick 3-minute check on SN1?' },
  action: { type: 'start_review', conceptIds: ['con_1'] },
  subjectId: null,
  ...patch,
})

function setup(brain = new FakeBrain()) {
  const w = studentWorld({ brain })
  const engine = createNudgeEngine({
    repos: w.repos,
    brain,
    bus: w.bus,
    clock: w.clock,
    localTime: w.localTime,
    log: () => {},
  })
  const run = (receptivity: Receptivity, candidates: NudgeCandidate[]) =>
    engine.run({ nowMs: w.clock.now(), receptivity, candidates: () => candidates })
  const all = (): Nudge[] => w.repos.nudges.listSince('2000-01-01T00:00:00.000Z')
  return { ...w, engine, run, all }
}

describe('nudge engine', () => {
  it('shows the best candidate at a natural break and announces it as a toast', async () => {
    const s = setup()
    const nudge = await s.run(atBreak, [
      cand({ dedupeKey: 'a', value: 0.5 }),
      cand({ dedupeKey: 'b', kind: 'struggle', value: 0.9, action: null }),
    ])
    expect(nudge).toMatchObject({
      kind: 'struggle',
      dedupeKey: 'b',
      title: '1 review due', // FakeBrain echoes the facts, so the template wins
      body: 'Quick 3-minute check on SN1?',
      outcome: 'pending',
      shownAt: '2026-10-24T09:00:00.000Z',
    })
    expect(s.all()).toEqual([nudge])
    const toast = s.events.find((e) => e.name === 'toast:show')?.payload as { toast: Toast }
    expect(toast.toast).toMatchObject({ kind: 'nudge', nudgeId: nudge?.id, ttlMs: 15_000 })
    expect(toast.toast.actions.map((a) => [a.id, a.label])).toEqual([
      ['accept', 'Got it'],
      ['snooze', 'In 1 hour'],
      ['dismiss', 'Not now'],
    ])
    expect(s.events.map((e) => e.name)).toEqual(['nudge:ready', 'toast:show', 'memory:changed'])
  })

  it('needs a natural break and a good enough score', async () => {
    const s = setup()
    expect(await s.run(noBreak, [cand()])).toBeNull()
    expect(await s.run(typing, [cand()])).toBeNull()
    expect(await s.run(atBreak, [cand({ value: 0.2 })])).toBeNull()
    expect(await s.run({ ...atBreak, score: 0.3 }, [cand({ value: 0.8 })])).toBeNull()
    expect(s.all()).toEqual([])
  })

  it('keeps one nudge open, the minimum gap and the daily cap', async () => {
    const s = setup()
    const first = await s.run(atBreak, [cand({ dedupeKey: 'k0' })])
    expect(await s.run(atBreak, [cand({ dedupeKey: 'k1' })])).toBeNull() // still open
    s.engine.act(first?.id ?? '', 'dismiss')
    expect(await s.run(atBreak, [cand({ dedupeKey: 'k1' })])).toBeNull() // minimum gap
    for (let i = 1; i <= 5; i++) {
      s.clock.advance(61 * MINUTE_MS)
      const n = await s.run(atBreak, [cand({ dedupeKey: `k${i}`, value: 1 })])
      if (n) s.engine.act(n.id, 'accept')
    }
    expect(s.all()).toHaveLength(4) // nudgesPerDay = 4
    s.clock.set('2026-10-25T09:00:00.000Z')
    expect(await s.run(atBreak, [cand({ dedupeKey: 'k9' })])).not.toBeNull()
  })

  it('never repeats a suggestion (dedupe key) and keeps tips to one a day', async () => {
    const s = setup()
    const n = await s.run(atBreak, [cand()])
    s.engine.act(n?.id ?? '', 'dismiss')
    s.clock.advance(2 * HOUR_MS)
    expect(await s.run(atBreak, [cand()])).toBeNull()
    const tip = (key: string) => cand({ kind: 'tip', dedupeKey: key, value: 0.4, action: null })
    const t1 = await s.run(atBreak, [tip('tip:context')])
    s.engine.act(t1?.id ?? '', 'accept')
    s.clock.advance(2 * HOUR_MS)
    expect(await s.run(atBreak, [tip('tip:examples')])).toBeNull()
  })

  it('expires an unanswered nudge after an hour', async () => {
    const s = setup()
    const n = await s.run(atBreak, [cand()])
    s.clock.advance(59 * MINUTE_MS)
    expect(s.all()[0]?.outcome).toBe('pending')
    s.clock.advance(2 * MINUTE_MS) // the expiry timer fires
    expect(s.all()[0]?.outcome).toBe('expired')
    expect(s.events.at(-1)).toEqual({
      name: 'memory:changed',
      payload: { scope: 'nudges', ids: [n?.id] },
    })
    expect(() => s.engine.act(n?.id ?? '', 'accept')).not.toThrow()
    expect(s.engine.act(n?.id ?? '', 'accept').action).toBeNull()
  })

  it('brings a snoozed nudge back an hour later, when the student is not busy', async () => {
    const s = setup()
    const ended = vi.fn()
    s.engine.onSnoozeEnd(ended)
    const n = await s.run(atBreak, [cand()])
    expect(s.engine.act(n?.id ?? '', 'snooze')).toMatchObject({
      nudge: { outcome: 'snoozed' },
      action: null,
    })
    s.clock.advance(30 * MINUTE_MS)
    expect(await s.run(noBreak, [])).toBeNull()
    s.clock.advance(30 * MINUTE_MS)
    expect(ended).toHaveBeenCalledOnce()
    expect(await s.run(typing, [])).toBeNull()
    const again = await s.run(noBreak, [])
    expect(again).toMatchObject({
      id: n?.id,
      outcome: 'pending',
      shownAt: '2026-10-24T10:00:00.000Z',
    })
    expect(shown(s.events)).toHaveLength(2)
    expect(s.engine.act(n?.id ?? '', 'accept')).toMatchObject({
      nudge: { outcome: 'accepted' },
      action: { type: 'start_review', conceptIds: ['con_1'] },
    })
  })

  it('drops snoozes left over from yesterday and rejects unknown nudges', async () => {
    const s = setup()
    s.clock.set('2026-10-24T21:00:00.000Z')
    const n = await s.run(atBreak, [cand()])
    s.engine.act(n?.id ?? '', 'snooze')
    s.clock.set('2026-10-25T08:30:00.000Z')
    expect(s.engine.expireStale(s.clock.now())).toEqual([n?.id])
    expect(() => s.engine.act('ndg_unknown', 'accept')).toThrow(/not found/)
  })

  it('uses the nudge writer when its text follows the rules', async () => {
    const brain = new FakeBrain({
      writeNudge: async () => ({
        title: 'Carbocations again?',
        body: '3-minute check? You missed two yesterday.',
      }),
    })
    const s = setup(brain)
    const n = await s.run(atBreak, [cand()])
    expect(n).toMatchObject({
      title: 'Carbocations again?',
      body: '3-minute check? You missed two yesterday.',
    })
  })

  it('lets dismissals tire out weak suggestions', async () => {
    const s = setup()
    for (let i = 0; i < 3; i++) {
      const n = await s.run(atBreak, [cand({ dedupeKey: `d${i}`, kind: 'struggle', value: 1 })])
      s.engine.act(n?.id ?? '', 'dismiss')
      s.clock.advance(61 * MINUTE_MS)
    }
    expect(await s.run(atBreak, [cand({ dedupeKey: 'weak', kind: 'tip', value: 0.5 })])).toBeNull()
    expect(
      await s.run(atBreak, [cand({ dedupeKey: 'strong', kind: 'deadline', value: 0.95 })]),
    ).not.toBeNull()
  })
})
