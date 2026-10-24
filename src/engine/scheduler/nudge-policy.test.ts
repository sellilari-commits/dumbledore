import { FakeBrain } from '@engine/testing/fake-brain'
import { DEFAULT_SETTINGS, type Nudge } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { HOUR_MS, MINUTE_MS } from './local-time'
import { checkCaps, fatigue, isExpired, isOpen, nudgeScore } from './nudge-policy'
import { isValidNudgeText, writeNudgeText } from './nudge-text'

const now = Date.parse('2026-10-24T12:00:00.000Z')
const coaching = DEFAULT_SETTINGS.coaching
const at = (offsetMs: number) => new Date(now + offsetMs).toISOString()

function nudge(patch: Partial<Nudge> = {}): Nudge {
  return {
    id: `ndg_${Math.random()}`,
    kind: 'review_due',
    title: 'Quick review?',
    body: 'Three-minute check on SN1?',
    action: null,
    dedupeKey: 'k',
    createdAt: at(-5 * HOUR_MS),
    shownAt: at(-5 * HOUR_MS),
    outcome: 'accepted',
    ...patch,
  }
}

describe('nudge caps', () => {
  const base = { nowMs: now, coaching, todayCount: 0, lastShownAt: null, openCount: 0 }

  it('allows a nudge when nothing stands in the way', () => {
    expect(checkCaps(base)).toEqual({ ok: true })
  })

  it('holds one open nudge at a time, the daily cap and the minimum gap', () => {
    expect(checkCaps({ ...base, openCount: 1 })).toEqual({ ok: false, reason: 'open' })
    expect(checkCaps({ ...base, todayCount: 4 })).toEqual({ ok: false, reason: 'dailyCap' })
    expect(checkCaps({ ...base, todayCount: 4 }, { countToday: false })).toEqual({ ok: true })
    expect(checkCaps({ ...base, lastShownAt: now - 59 * MINUTE_MS })).toEqual({
      ok: false,
      reason: 'minGap',
    })
    expect(checkCaps({ ...base, lastShownAt: now - 60 * MINUTE_MS })).toEqual({ ok: true })
    const strict = { ...coaching, nudgesPerDay: 0 }
    expect(checkCaps({ ...base, coaching: strict })).toEqual({ ok: false, reason: 'dailyCap' })
  })
})

describe('fatigue and score', () => {
  it('grows with recent nudges, dismissals and a recently dismissed kind', () => {
    expect(fatigue([], 'review_due', now)).toBe(0)
    const twoRecent = [nudge({ shownAt: at(-HOUR_MS) }), nudge({ shownAt: at(-2 * HOUR_MS) })]
    expect(fatigue(twoRecent, 'tip', now)).toBeCloseTo(0.2)
    const dismissive = [
      nudge({ outcome: 'dismissed', kind: 'struggle', createdAt: at(-30 * HOUR_MS) }),
      nudge({ outcome: 'dismissed', kind: 'struggle', createdAt: at(-30 * HOUR_MS) }),
      nudge({ outcome: 'expired' }),
      nudge({ outcome: 'accepted' }),
    ]
    expect(fatigue(dismissive, 'review_due', now)).toBeCloseTo(0.3 * (2.5 / 4))
    const justDismissed = [
      ...dismissive,
      nudge({
        outcome: 'dismissed',
        kind: 'review_due',
        createdAt: at(-HOUR_MS),
        shownAt: at(-HOUR_MS),
      }),
    ]
    expect(fatigue(justDismissed, 'review_due', now)).toBeCloseTo(0.1 + 0.3 * (3.5 / 5) + 0.3)
    expect(fatigue(justDismissed, 'tip', now)).toBeCloseTo(0.1 + 0.3 * (3.5 / 5))
  })

  it('scores value × receptivity − fatigue', () => {
    expect(nudgeScore(0.8, 1, 0.1)).toBeCloseTo(0.7)
    expect(nudgeScore(0.8, 0, 0)).toBe(0)
  })

  it('expires pending nudges after an hour', () => {
    const pending = nudge({ outcome: 'pending', shownAt: at(-59 * MINUTE_MS) })
    expect(isExpired(pending, now)).toBe(false)
    expect(isOpen(pending, now)).toBe(true)
    expect(isExpired(pending, now + MINUTE_MS)).toBe(true)
    expect(isOpen(pending, now + MINUTE_MS)).toBe(false)
    expect(isExpired(nudge({ outcome: 'snoozed', shownAt: at(-3 * HOUR_MS) }), now)).toBe(false)
  })
})

describe('nudge text', () => {
  it('accepts short single-call-to-action text and rejects the rest', () => {
    expect(
      isValidNudgeText('Quick check?', '3-minute check on carbocations? You missed two yesterday.'),
    ).toBe(true)
    expect(isValidNudgeText('', 'Body')).toBe(false)
    expect(isValidNudgeText('A title that is far too long here', 'Body?')).toBe(false)
    expect(
      isValidNudgeText(
        'Hi',
        'one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen',
      ),
    ).toBe(false)
    expect(isValidNudgeText('Hi', 'Ready? Set? Go?')).toBe(false)
    expect(isValidNudgeText('Hi', 'due=3; concepts=SN1')).toBe(false)
  })

  const input = {
    kind: 'review_due' as const,
    facts: 'due=2; concepts=SN1, E1',
    language: 'en',
    fallback: { title: '2 reviews due', body: '3-minute check on SN1 and 1 more?' },
  }

  it('uses the nudge writer when it follows the rules', async () => {
    const brain = new FakeBrain({
      writeNudge: async () => ({
        title: '"Quick check?"',
        body: '3-minute check on SN1? You missed it yesterday.',
      }),
    })
    expect(await writeNudgeText(brain, input)).toEqual({
      title: 'Quick check?',
      body: '3-minute check on SN1? You missed it yesterday.',
      source: 'llm',
    })
    expect(brain.calls[0]?.input).toEqual({
      kind: 'review_due',
      facts: input.facts,
      language: 'en',
    })
  })

  it('falls back to the template when the writer fails or rambles', async () => {
    expect(await writeNudgeText(new FakeBrain(), input)).toEqual({
      ...input.fallback,
      source: 'template',
    })
    const down = new FakeBrain({
      writeNudge: async () => {
        throw new Error('timeout')
      },
    })
    expect((await writeNudgeText(down, input, () => {})).source).toBe('template')
  })
})
