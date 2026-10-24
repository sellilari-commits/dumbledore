/**
 * A Clock that can be set to any instant, backwards included. The demo seed uses it to write
 * records "in the past" through the normal repository API (which stamps clock.nowIso()).
 */
import type { Cancel, Clock } from '../../clock'

export class ManualClock implements Clock {
  private current: number

  constructor(start: number | string = Date.now()) {
    this.current = typeof start === 'number' ? start : Date.parse(start)
  }

  now(): number {
    return this.current
  }

  nowIso(): string {
    return new Date(this.current).toISOString()
  }

  set(at: number | string): this {
    this.current = typeof at === 'number' ? at : Date.parse(at)
    return this
  }

  /** Timers never fire: seeding is synchronous. */
  setTimeout(): Cancel {
    return () => {}
  }

  setInterval(): Cancel {
    return () => {}
  }
}
