/**
 * Time source. Everything time-dependent (cadence, dwell, scheduling, nudges) takes a Clock so
 * tests can run days in milliseconds with FakeClock.
 */

export type Cancel = () => void

export interface Clock {
  now(): number // epoch ms
  nowIso(): string
  setTimeout(fn: () => void, ms: number): Cancel
  setInterval(fn: () => void, ms: number): Cancel
}

export const systemClock: Clock = {
  now: () => Date.now(),
  nowIso: () => new Date().toISOString(),
  setTimeout(fn, ms) {
    const handle = setTimeout(fn, ms)
    return () => clearTimeout(handle)
  },
  setInterval(fn, ms) {
    const handle = setInterval(fn, ms)
    return () => clearInterval(handle)
  },
}

interface Timer {
  id: number
  at: number
  fn: () => void
  every: number | null
}

/** Deterministic clock for tests: time only moves when you call advance()/set(). */
export class FakeClock implements Clock {
  private current: number
  private timers: Timer[] = []
  private nextId = 1

  constructor(start: string | number = '2026-10-24T09:00:00.000Z') {
    this.current = typeof start === 'number' ? start : Date.parse(start)
  }

  now(): number {
    return this.current
  }

  nowIso(): string {
    return new Date(this.current).toISOString()
  }

  setTimeout(fn: () => void, ms: number): Cancel {
    return this.add(fn, ms, null)
  }

  setInterval(fn: () => void, ms: number): Cancel {
    return this.add(fn, ms, Math.max(1, ms))
  }

  /** Moves time forward, firing due timers in order (including ones they schedule). */
  advance(ms: number): void {
    const target = this.current + ms
    for (;;) {
      const due = this.timers
        .filter((t) => t.at <= target)
        .sort((a, b) => a.at - b.at || a.id - b.id)[0]
      if (!due) break
      this.current = due.at
      if (due.every === null) {
        this.timers = this.timers.filter((t) => t.id !== due.id)
      } else {
        due.at += due.every
      }
      due.fn()
    }
    this.current = target
  }

  set(iso: string): void {
    const target = Date.parse(iso)
    if (target < this.current) throw new Error('FakeClock cannot go backwards')
    this.advance(target - this.current)
  }

  pendingTimers(): number {
    return this.timers.length
  }

  private add(fn: () => void, ms: number, every: number | null): Cancel {
    const timer: Timer = { id: this.nextId++, at: this.current + Math.max(0, ms), fn, every }
    this.timers.push(timer)
    return () => {
      this.timers = this.timers.filter((t) => t.id !== timer.id)
    }
  }
}
