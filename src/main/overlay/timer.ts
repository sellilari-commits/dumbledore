/**
 * The timer square under the orb: the student picks a length (5–60 min or a custom 1–180), the
 * square counts down, and while it runs the student can add or take off minutes (never below one
 * minute left) or stop it. When it runs out, a macOS notification
 * says so (no box beside the orb) and the square goes back to idle. Lives in main, so it keeps
 * running when the overlay page reloads.
 */
import type { Cancel, Clock } from '@engine/clock'

export const DEFAULT_TIMER_MINUTES = 25
export const MIN_TIMER_MINUTES = 1
export const MAX_TIMER_MINUTES = 180
const MINUTE = 60_000

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
  private startedAt = 0
  private cancel: Cancel | null = null

  constructor(
    private readonly clock: Clock,
    private readonly notify: (notice: TimerNotice) => void,
    private readonly onChange: () => void,
  ) {}

  /** ISO start and end while running, else null. */
  get state(): { startedAt: string; endsAt: string } | null {
    return this.endsAt === null
      ? null
      : {
          startedAt: new Date(this.startedAt).toISOString(),
          endsAt: new Date(this.endsAt).toISOString(),
        }
  }

  get running(): boolean {
    return this.endsAt !== null
  }

  /** Starts (or restarts) a timer of `minutes` (clamped to 1–180). */
  start(minutes: number): void {
    this.startedAt = this.clock.now()
    this.schedule(this.startedAt + clampTimerMinutes(minutes) * MINUTE)
  }

  /**
   * Moves the end by `deltaMinutes` while running: at least one minute stays, and the time left
   * never exceeds the longest length (180 min). Does nothing when idle.
   */
  adjust(deltaMinutes: number): void {
    if (this.endsAt === null || !Number.isFinite(deltaMinutes)) return
    const now = this.clock.now()
    const target = this.endsAt + Math.round(deltaMinutes) * MINUTE
    // Taking time off stops at one minute left (or where it is, if less is left already).
    const floor = Math.min(this.endsAt, now + MINUTE)
    const end = Math.min(now + MAX_TIMER_MINUTES * MINUTE, Math.max(floor, target))
    if (end === this.endsAt) return
    this.schedule(end)
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

  private schedule(endsAt: number): void {
    this.cancel?.()
    this.endsAt = endsAt
    this.cancel = this.clock.setTimeout(() => this.finish(), endsAt - this.clock.now())
    this.onChange()
  }

  private finish(): void {
    const minutes = Math.max(1, Math.round(((this.endsAt ?? 0) - this.startedAt) / MINUTE))
    this.cancel = null
    this.endsAt = null
    try {
      this.notify(timerDone(minutes))
    } finally {
      this.onChange()
    }
  }
}
