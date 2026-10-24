import { FakeClock } from '@engine/clock'
import { createEngineBus } from '@engine/events'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { OverlayState } from '@shared/state'
import { describe, expect, it } from 'vitest'
import { DISPLAY } from '../testing/harness'
import { OverlayController } from './controller'
import { clampTimerMinutes, type TimerNotice, timerDone } from './timer'

const MIN = 60_000

function setup() {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const notices: TimerNotice[] = []
  const states: OverlayState[] = []
  const controller = new OverlayController({
    bus: createEngineBus(),
    clock,
    settings: repos.settings,
    study: { current: () => null, picker: () => ({ subjects: [] }) },
    perception: { aiChat: () => null },
    onChange: (s) => states.push(s),
    notify: (n) => notices.push(n),
  })
  controller.setDisplays([DISPLAY])
  controller.start()
  return { clock, controller, notices, states, repos }
}

describe('timer square', () => {
  it('starts idle with the remembered length (25 by default)', () => {
    const t = setup()
    expect(t.controller.state.timer).toBeNull()
    expect(t.controller.state.timerMinutes).toBe(25)
  })

  it('starts the chosen length, remembers it, and a click while running stops it', () => {
    const t = setup()
    t.controller.startTimer(45)
    expect(t.controller.state.timer).toEqual({
      endsAt: new Date(t.clock.now() + 45 * MIN).toISOString(),
    })
    expect(t.controller.state.timerMinutes).toBe(45)
    expect(t.repos.settings.get().timerMinutes).toBe(45)
    t.controller.stopTimer()
    expect(t.controller.state.timer).toBeNull()
    t.clock.advance(46 * MIN)
    expect(t.notices).toEqual([])
  })

  it('sends one macOS notification naming the length when it runs out, with no overlay box', () => {
    const t = setup()
    t.controller.startTimer(15)
    t.clock.advance(15 * MIN - 1000)
    expect(t.notices).toEqual([])
    t.clock.advance(1000)
    expect(t.notices).toEqual([
      { title: 'Time’s up', body: '15 minutes done. Take a short break.' },
    ])
    expect(t.controller.state.timer).toBeNull()
    expect(t.controller.state.toasts).toEqual([])
    t.clock.advance(15 * MIN)
    expect(t.notices).toHaveLength(1)
  })

  it('adds and takes off minutes while running; the notification fires at the new end', () => {
    const t = setup()
    t.controller.startTimer(25)
    const start = t.clock.now()
    t.controller.adjustTimer(5)
    expect(t.controller.state.timer).toEqual({ endsAt: new Date(start + 30 * MIN).toISOString() })
    t.controller.adjustTimer(-5)
    t.controller.adjustTimer(-1)
    expect(t.controller.state.timer).toEqual({ endsAt: new Date(start + 24 * MIN).toISOString() })
    expect(t.repos.settings.get().timerMinutes).toBe(25)
    t.clock.advance(24 * MIN - 1000)
    expect(t.notices).toEqual([])
    t.clock.advance(1000)
    expect(t.notices).toEqual([
      { title: 'Time’s up', body: '24 minutes done. Take a short break.' },
    ])
  })

  it('never goes below one minute left, never lengthens on a minus, and ignores adjust when idle', () => {
    const t = setup()
    t.controller.adjustTimer(5)
    expect(t.controller.state.timer).toBeNull()
    t.controller.startTimer(5)
    t.controller.adjustTimer(-5)
    expect(t.controller.state.timer).toEqual({
      endsAt: new Date(t.clock.now() + MIN).toISOString(),
    })
    t.clock.advance(30_000)
    const before = t.controller.state.timer
    t.controller.adjustTimer(-1)
    expect(t.controller.state.timer).toEqual(before)
    t.controller.adjustTimer(500)
    expect(Date.parse(t.controller.state.timer?.endsAt ?? '') - t.clock.now()).toBe(180 * MIN)
  })

  it('a stop from the running chooser clears it with no notification', () => {
    const t = setup()
    t.controller.startTimer(15)
    t.controller.adjustTimer(5)
    t.controller.stopTimer()
    expect(t.controller.state.timer).toBeNull()
    t.clock.advance(30 * MIN)
    expect(t.notices).toEqual([])
  })

  it('clamps custom lengths to 1–180 whole minutes', () => {
    expect(clampTimerMinutes(0)).toBe(1)
    expect(clampTimerMinutes(500)).toBe(180)
    expect(clampTimerMinutes(12.4)).toBe(12)
    expect(clampTimerMinutes(Number.NaN)).toBe(25)
    expect(timerDone(1).body).toBe('1 minute done. Take a short break.')
  })
})
