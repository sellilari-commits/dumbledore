/**
 * The timer square under the orb: the student picks a length (5–60 min or a custom 1–180), the
 * square counts down, and a click while it runs stops it. When it runs out, a macOS notification
 * says so (no box beside the orb) and the square goes back to idle. Lives in main, so it keeps
 * running when the overlay page reloads.
 */
import type { Cancel, Clock } from '@engine/clock'

export const DEFAULT_TIMER_MINUTES = 25
export const MIN_TIMER_MINUTES = 1
export const MAX_TIMER_MINUTES = 180

export interface TimerNotice {
  title: string
  body: string
}

/** Whole minutes within the allowed range (fractions round, junk falls back to the default). */
export function clampTimerMinutes(minutes: number): number {
  if (!Number.isFinite(minutes)) return DEFAULT_TIMER_MINUTES
  return Math.min(MAX_TIMER_MINUTES, Math.max(MIN_TIMER_MINUTES, Math.round(minutes)))
}

export function timerDone(minutes: number): TimerNotice {
  return {
    title: 'Time’s up',
    body: `${minutes} ${minutes === 1 ? 'minute' : 'minutes'} done. Take a short break.`,
  }
}

export class FocusTimer {
  private endsAt: number | null = null
  private minutes = 0
  private cancel: Cancel | null = null

  constructor(
    private readonly clock: Clock,
    private readonly notify: (notice: TimerNotice) => void,
    private readonly onChange: () => void,
  ) {}

  /** ISO end time while running, else null. */
  get state(): { endsAt: string } | null {
    return this.endsAt === null ? null : { endsAt: new Date(this.endsAt).toISOString() }
  }

  get running(): boolean {
    return this.endsAt !== null
  }

  /** Starts (or restarts) a timer of `minutes` (clamped to 1–180). */
  start(minutes: number): void {
    this.cancel?.()
    this.minutes = clampTimerMinutes(minutes)
    const ms = this.minutes * 60_000
    this.endsAt = this.clock.now() + ms
    this.cancel = this.clock.setTimeout(() => this.finish(), ms)
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
      this.notify(timerDone(this.minutes))
    } finally {
      this.onChange()
    }
  }
}
