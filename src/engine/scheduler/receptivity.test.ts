import { FakeClock } from '@engine/clock'
import { createEngineBus } from '@engine/events'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { FrontmostInfo } from '@shared/helper-protocol'
import { describe, expect, it } from 'vitest'
import { fixedOffsetLocalTime, MINUTE_MS } from './local-time'
import { type BreakKind, createReceptivityDetector } from './receptivity'
import { textField as field, frontmost } from './scheduler-fixtures'

/** A fake student: input resets the idle counter; the poll samples it every 15 s. */
function world(start = '2026-10-24T09:00:00.000Z') {
  const clock = new FakeClock(start)
  const bus = createEngineBus()
  const repos = createMemoryRepos(clock)
  let lastInput = clock.now()
  let front: FrontmostInfo | null = frontmost('com.apple.Preview', 'Preview')
  let helperUp = true
  const det = createReceptivityDetector({
    bus,
    clock,
    settings: () => repos.settings.get(),
    localTime: fixedOffsetLocalTime(0),
    signals: {
      idleSeconds: async () => {
        if (!helperUp) throw new Error('helper down')
        return (clock.now() - lastInput) / 1000
      },
      frontmost: async () => front,
    },
  })
  const breaks: BreakKind[] = []
  det.onBreak((kind) => breaks.push(kind))
  det.start()
  const flush = () => new Promise<void>((resolve) => setImmediate(resolve))
  /** Moves time in poll-sized steps, letting each async sample land. */
  const pass = async (ms: number, opts: { active?: boolean } = {}) => {
    for (let left = ms; left > 0; left -= 15_000) {
      clock.advance(Math.min(15_000, left))
      if (opts.active) lastInput = clock.now()
      await flush()
    }
  }
  const act = async () => {
    lastInput = clock.now()
    await det.refresh()
  }
  /** The student brings another app to the front. */
  const switchTo = (bundleId: string, appName: string) => {
    front = frontmost(bundleId, appName)
    lastInput = clock.now()
    bus.emit('helper:appActivated', { pid: 7, bundleId, appName })
  }
  return {
    switchTo,
    clock,
    bus,
    repos,
    det,
    breaks,
    pass,
    act,
    setFront: (f: FrontmostInfo | null) => {
      front = f
    },
    setHelperUp: (up: boolean) => {
      helperUp = up
    },
  }
}

describe('receptivity: natural breaks', () => {
  it('opens a start-of-day break, which closes once the student is settled', async () => {
    const w = world()
    await w.act()
    expect(w.det.evaluate()).toEqual({
      receptive: true,
      score: 1,
      blockers: [],
      breaks: ['firstActivity'],
    })
    await w.pass(11 * MINUTE_MS, { active: true })
    expect(w.det.evaluate()).toEqual({ receptive: false, score: 0, blockers: [], breaks: [] })
  })

  it('opens a break when the student comes back from ≥ 2 min away', async () => {
    const w = world()
    await w.act()
    await w.pass(15 * MINUTE_MS, { active: true })
    await w.pass(3 * MINUTE_MS) // away
    expect(w.det.evaluate().blockers).toEqual(['away'])
    await w.act()
    expect(w.det.evaluate()).toMatchObject({ receptive: true, score: 0.7, breaks: ['returned'] })
    expect(w.breaks).toEqual(['firstActivity', 'returned'])
    await w.pass(4 * MINUTE_MS, { active: true })
    expect(w.det.isReceptive()).toBe(false)

    await w.pass(10 * MINUTE_MS) // a longer pause counts fully
    await w.act()
    expect(w.det.evaluate()).toMatchObject({ score: 1, breaks: ['returned'] })
  })

  it('does not count a short pause as a break', async () => {
    const w = world()
    await w.pass(15 * MINUTE_MS, { active: true })
    await w.pass(90_000)
    await w.act()
    expect(w.det.isReceptive()).toBe(false)
  })

  it('opens a break when switching away after a stint of work, not after leisure', async () => {
    const w = world()
    await w.pass(12 * MINUTE_MS, { active: true }) // 12 min in Preview
    w.switchTo('com.apple.MobileSMS', 'Messages')
    expect(w.det.evaluate()).toMatchObject({
      receptive: true,
      score: 0.8,
      breaks: ['switchedAway'],
    })
    await w.pass(15 * MINUTE_MS, { active: true }) // 15 min in Messages
    w.switchTo('com.microsoft.Word', 'Word')
    expect(w.det.evaluate().breaks).toEqual([])
    await w.pass(2 * MINUTE_MS, { active: true }) // a short stint is no break either
    w.switchTo('com.apple.Safari', 'Safari')
    expect(w.det.evaluate().breaks).toEqual([])
    await w.pass(20 * MINUTE_MS, { active: true })
    // Dumbledore's own windows are not an app switch.
    w.bus.emit('helper:appActivated', {
      pid: 10,
      bundleId: 'org.stuhi.dumbledore',
      appName: 'Dumbledore',
    })
    expect(w.det.evaluate().breaks).toEqual([])
  })

  it('opens the 30–60 min window after a finished study session', async () => {
    const w = world()
    await w.pass(15 * MINUTE_MS, { active: true })
    w.det.noteSessionComplete(w.clock.now())
    await w.pass(29 * MINUTE_MS, { active: true })
    expect(w.det.evaluate().breaks).toEqual([])
    await w.pass(2 * MINUTE_MS, { active: true })
    expect(w.det.evaluate()).toMatchObject({
      receptive: true,
      score: 0.9,
      breaks: ['afterSession'],
    })
    expect(w.breaks.at(-1)).toBe('afterSession')
    await w.pass(30 * MINUTE_MS, { active: true })
    expect(w.det.evaluate().breaks).toEqual([])
  })

  it('treats the first activity of a new day as a break, and unlocking after a while too', async () => {
    const w = world('2026-10-24T21:00:00.000Z')
    await w.act() // evening start: not the start of the day
    expect(w.det.evaluate().breaks).toEqual([])
    w.bus.emit('helper:screenLocked', { locked: true })
    expect(w.det.evaluate().blockers).toContain('locked')
    w.clock.set('2026-10-25T08:30:00.000Z')
    w.bus.emit('helper:screenLocked', { locked: false })
    await w.act()
    expect(w.det.evaluate()).toMatchObject({
      receptive: true,
      breaks: ['returned', 'firstActivity'],
    })
  })
})

describe('receptivity: never while busy', () => {
  it('blocks while typing in a field, and once the student pauses it clears', async () => {
    const w = world()
    await w.act()
    w.bus.emit('helper:focus', {
      app: { pid: 42, bundleId: 'com.google.Chrome', appName: 'Google Chrome' },
      element: field(),
    })
    await w.act()
    expect(w.det.evaluate()).toMatchObject({ receptive: false, blockers: ['typing'] })
    await w.pass(20_000) // reading the answer, hands off
    expect(w.det.evaluate().blockers).toEqual([])
    w.bus.emit('helper:focus', { app: null, element: field({ isSecure: true }) })
    await w.pass(30_000)
    expect(w.det.evaluate().blockers).toContain('typing') // password fields always count
  })

  it('blocks full-screen apps', async () => {
    const w = world()
    w.setFront(frontmost('com.apple.TV', 'TV', { isFullScreen: true }))
    await w.act()
    expect(w.det.evaluate()).toMatchObject({ receptive: false, blockers: ['fullScreen'] })
  })

  it('blocks meeting apps, meeting pages, and the minutes after a call', async () => {
    const w = world()
    w.setFront(frontmost('us.zoom.xos', 'zoom.us'))
    await w.act()
    expect(w.det.evaluate().blockers).toEqual(['meeting'])
    w.setFront(frontmost('com.apple.Notes', 'Notes'))
    await w.act()
    expect(w.det.evaluate().blockers).toEqual(['meeting']) // probably still on the call
    await w.pass(11 * MINUTE_MS, { active: true })
    expect(w.det.evaluate().blockers).toEqual([])

    w.setFront(
      frontmost('com.google.Chrome', 'Google Chrome', {
        url: 'https://meet.google.com/abc-defg-hij',
        windowTitle: 'Meet',
      }),
    )
    await w.act()
    expect(w.det.evaluate().blockers).toEqual(['meeting'])
    w.setFront(frontmost('com.microsoft.teams2', 'Microsoft Teams'))
    await w.pass(15 * MINUTE_MS, { active: true })
    expect(w.det.evaluate().blockers).toEqual(['meeting'])
    w.bus.emit('perception:now', {
      now: {
        app: 'Safari',
        title: 'Weekly sync | Microsoft Teams',
        url: null,
        minutes: 3,
        kind: 'other',
        subjectId: null,
        suggestion: null,
      },
    })
    expect(w.det.evaluate().blockers).toContain('meeting')
  })

  it('respects quiet hours, including windows across midnight', async () => {
    const w = world('2026-10-24T22:45:00.000Z')
    await w.act()
    expect(w.det.evaluate().blockers).toEqual(['quietHours'])
    w.repos.settings.update({
      coaching: {
        ...w.repos.settings.get().coaching,
        quietHours: { start: '13:00', end: '14:00' },
      },
    })
    expect(w.det.evaluate().blockers).toEqual([])
    w.repos.settings.update({ coaching: { ...w.repos.settings.get().coaching, quietHours: null } })
    expect(w.det.evaluate().blockers).toEqual([])
  })

  it('stays quiet without fresh signals from the helper', async () => {
    const w = world()
    expect(w.det.evaluate().blockers).toEqual(['noSignal'])
    await w.act()
    w.setHelperUp(false)
    await w.pass(3 * MINUTE_MS)
    expect(w.det.evaluate().blockers).toContain('noSignal')
    w.det.stop()
  })
})
