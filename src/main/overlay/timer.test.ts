import { FakeClock } from '@engine/clock'
import { createEngineBus } from '@engine/events'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { OverlayState } from '@shared/state'
import { describe, expect, it } from 'vitest'
import { DISPLAY } from '../testing/harness'
import { OverlayController } from './controller'
import { TIMER_DONE, TIMER_MS, type TimerNotice } from './timer'

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
  return { clock, controller, notices, states }
}

describe('timer square', () => {
  it('starts idle; a click starts 25 minutes, a second click stops it', () => {
    const t = setup()
    expect(t.controller.state.timer).toBeNull()
    t.controller.timer.toggle()
    expect(t.controller.state.timer).toEqual({
      endsAt: new Date(t.clock.now() + TIMER_MS).toISOString(),
    })
    expect(t.states.at(-1)?.timer).not.toBeNull()
    t.controller.timer.toggle()
    expect(t.controller.state.timer).toBeNull()
    t.clock.advance(TIMER_MS + 1000)
    expect(t.notices).toEqual([])
  })

  it('sends one macOS notification when it runs out, then goes idle, with no overlay box', () => {
    const t = setup()
    t.controller.timer.toggle()
    t.clock.advance(TIMER_MS - 1000)
    expect(t.notices).toEqual([])
    t.clock.advance(1000)
    expect(t.notices).toEqual([TIMER_DONE])
    expect(t.controller.state.timer).toBeNull()
    expect(t.controller.state.toasts).toEqual([])
    t.clock.advance(TIMER_MS)
    expect(t.notices).toHaveLength(1)
  })
})
