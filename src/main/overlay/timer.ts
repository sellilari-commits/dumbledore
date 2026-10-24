/**
 * The timer square under the orb: one click starts a 25-minute timer, a second click stops it.
 * When it runs out, a macOS notification says so (no box beside the orb) and the square goes
 * back to idle. Lives in main, so it keeps running when the overlay page reloads.
 */
import type { Cancel, Clock } from '@engine/clock'

export const TIMER_MS = 25 * 60 * 1000

export interface TimerNotice {
  title: string
  body: string
}

export const TIMER_DONE: TimerNotice = {
  title: 'Time’s up',
  body: '25 minutes done. Take a short break.',
}

export class FocusTimer {
  private endsAt: number | null = null
  private cancel: Cancel | null = null

  constructor(
    private readonly clock: Clock,
    private readonly notify: (notice: TimerNotice) => void,
    private readonly onChange: () => void,
    private readonly durationMs: number = TIMER_MS,
  ) {}

  /** ISO end time while running, else null. */
  get state(): { endsAt: string } | null {
    return this.endsAt === null ? null : { endsAt: new Date(this.endsAt).toISOString() }
  }

  /** Starts the timer when idle, stops it when running. */
  toggle(): void {
    if (this.endsAt === null) this.start()
    else this.stop()
  }

  start(): void {
    this.cancel?.()
    this.endsAt = this.clock.now() + this.durationMs
    this.cancel = this.clock.setTimeout(() => this.finish(), this.durationMs)
    this.onChange()
  }

  stop(): void {
    if (this.endsAt === null) return
    this.cancel?.()
    this.cancel = null
    this.endsAt = null
    this.onChange()
  }

  dispose(): void {
    this.cancel?.()
    this.cancel = null
  }

  private finish(): void {
    this.cancel = null
    this.endsAt = null
    try {
      this.notify(TIMER_DONE)
    } finally {
      this.onChange()
    }
  }
}
