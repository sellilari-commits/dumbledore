/**
 * Test fixtures for the scheduler and follow-ups: a simulated student (input, idle time, the
 * frontmost window, focused fields, screen lock) driving the helper signals and bus events over a
 * FakeClock, plus builders for helper payloads. Test-only.
 */
import type { Brain } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import { createEngineBus, type EngineEvents } from '@engine/events'
import { FakeBrain } from '@engine/testing/fake-brain'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { FocusedElement, FrontmostInfo } from '@shared/helper-protocol'
import { fixedOffsetLocalTime } from './local-time'
import type { ReceptivitySignals } from './receptivity'

export function frontmost(
  bundleId: string,
  appName: string,
  patch: Partial<FrontmostInfo> = {},
): FrontmostInfo {
  return {
    pid: 42,
    bundleId,
    appName,
    windowId: 1,
    windowTitle: null,
    windowFrame: null,
    isFullScreen: false,
    url: null,
    ...patch,
  }
}

export function textField(patch: Partial<FocusedElement> = {}): FocusedElement {
  return {
    pid: 42,
    bundleId: 'com.google.Chrome',
    appName: 'Google Chrome',
    role: 'AXTextArea',
    subrole: null,
    editable: true,
    isSecure: false,
    frame: null,
    caret: null,
    placeholder: null,
    valueLength: 0,
    ref: null,
    ...patch,
  }
}

export interface RecordedEvent {
  name: keyof EngineEvents
  payload: unknown
}

export function studentWorld(opts: { start?: string; brain?: Brain } = {}) {
  const clock = new FakeClock(opts.start ?? '2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const brain = opts.brain ?? new FakeBrain()
  const localTime = fixedOffsetLocalTime(0)
  let lastInput = clock.now()
  let front: FrontmostInfo | null = frontmost('com.apple.Preview', 'Preview')
  let helperUp = true
  const signals: ReceptivitySignals = {
    idleSeconds: async () => {
      if (!helperUp) throw new Error('helper down')
      return (clock.now() - lastInput) / 1000
    },
    frontmost: async () => front,
  }
  const events: RecordedEvent[] = []
  for (const name of ['memory:changed', 'nudge:ready', 'toast:show'] as const) {
    bus.on(name, (payload) => events.push({ name, payload }))
  }
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))

  const student = {
    input() {
      lastInput = clock.now()
    },
    /** Time passes in 15 s steps; an active student keeps touching the keyboard or mouse. */
    async pass(ms: number, { active = true }: { active?: boolean } = {}) {
      for (let left = ms; left > 0; left -= 15_000) {
        clock.advance(Math.min(15_000, left))
        if (active) lastInput = clock.now()
        await flush()
      }
    },
    /** Steps away for `ms` (no input), then comes back and touches the trackpad. */
    async away(ms: number) {
      await student.pass(ms, { active: false })
      lastInput = clock.now()
    },
    switchTo(bundleId: string, appName: string, patch: Partial<FrontmostInfo> = {}) {
      front = frontmost(bundleId, appName, patch)
      lastInput = clock.now()
      bus.emit('helper:appActivated', { pid: 7, bundleId, appName })
    },
    focus(element: FocusedElement | null) {
      lastInput = clock.now()
      bus.emit('helper:focus', {
        app: element
          ? { pid: element.pid, bundleId: element.bundleId, appName: element.appName }
          : null,
        element,
      })
    },
    setFront(info: FrontmostInfo | null) {
      front = info
    },
    lock(locked: boolean) {
      if (!locked) lastInput = clock.now()
      bus.emit('helper:screenLocked', { locked })
    },
    helper(up: boolean) {
      helperUp = up
    },
  }

  return { clock, repos, bus, brain, localTime, signals, events, student, flush }
}

export const shown = (events: readonly RecordedEvent[]) =>
  events.filter((e) => e.name === 'nudge:ready')
