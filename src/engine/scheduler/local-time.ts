/**
 * Local wall-clock helpers for scheduling: day boundaries, minutes of the day, "HH:MM" windows
 * and deadline parsing.
 *
 * Everything that depends on the student's time zone goes through a `LocalTime`, so tests can pin
 * a fixed offset (`fixedOffsetLocalTime(0)` = UTC) while the app uses the system zone.
 */

export const MINUTE_MS = 60_000
export const HOUR_MS = 60 * MINUTE_MS
export const DAY_MS = 24 * HOUR_MS

export interface LocalTime {
  /** Epoch ms of local midnight for the day that contains `ms`. */
  dayStart(ms: number): number
  /** Minutes since local midnight, 0–1439. */
  minuteOfDay(ms: number): number
  /** Local calendar day as "YYYY-MM-DD". */
  dayKey(ms: number): string
  /** Epoch ms of local midnight of a "YYYY-MM-DD" day. */
  startOfDayKey(key: string): number
}

const pad = (n: number): string => String(n).padStart(2, '0')

/** The machine's own time zone (what the student sees on the menu bar clock). */
export const systemLocalTime: LocalTime = {
  dayStart(ms) {
    const d = new Date(ms)
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  },
  minuteOfDay(ms) {
    const d = new Date(ms)
    return d.getHours() * 60 + d.getMinutes()
  },
  dayKey(ms) {
    const d = new Date(ms)
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
  },
  startOfDayKey(key) {
    const [y, m, d] = key.split('-').map(Number)
    return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1).getTime()
  },
}

/** A zone with a constant UTC offset (minutes east of UTC). Deterministic; used by tests. */
export function fixedOffsetLocalTime(offsetMinutes: number): LocalTime {
  const offsetMs = offsetMinutes * MINUTE_MS
  const shifted = (ms: number) => new Date(ms + offsetMs)
  return {
    dayStart(ms) {
      const d = shifted(ms)
      return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - offsetMs
    },
    minuteOfDay(ms) {
      const d = shifted(ms)
      return d.getUTCHours() * 60 + d.getUTCMinutes()
    },
    dayKey(ms) {
      const d = shifted(ms)
      return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
    },
    startOfDayKey(key) {
      const [y, m, d] = key.split('-').map(Number)
      return Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) - offsetMs
    },
  }
}

/** "HH:MM" → minutes since midnight, or null when malformed. */
export function parseHhMm(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim())
  if (!match) return null
  const h = Number(match[1])
  const m = Number(match[2])
  if (h > 23 || m > 59) return null
  return h * 60 + m
}

/** Whether `minute` lies in [start, end), wrapping past midnight when start > end. */
export function inMinuteWindow(minute: number, start: number, end: number): boolean {
  if (start === end) return false
  return start < end ? minute >= start && minute < end : minute >= start || minute < end
}

/** Quiet hours from settings ("22:30"–"08:00"); malformed or null settings mean none. */
export function inQuietHours(
  ms: number,
  quiet: { start: string; end: string } | null,
  lt: LocalTime,
): boolean {
  if (!quiet) return false
  const start = parseHhMm(quiet.start)
  const end = parseHhMm(quiet.end)
  if (start === null || end === null) return false
  return inMinuteWindow(lt.minuteOfDay(ms), start, end)
}

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/

/**
 * Deadline instant in epoch ms. A date without a time ("2026-12-12") means the start of that
 * local day, so "due tomorrow" flips at midnight. Unparseable values give null.
 */
export function parseDeadline(iso: string | null | undefined, lt: LocalTime): number | null {
  if (!iso) return null
  const trimmed = iso.trim()
  if (DATE_ONLY.test(trimmed)) return lt.startOfDayKey(trimmed)
  const ms = Date.parse(trimmed)
  return Number.isNaN(ms) ? null : ms
}

/** ISO week key ("2026-W43") for once-a-week dedupe keys. */
export function weekKey(ms: number, lt: LocalTime): string {
  const start = lt.dayStart(ms)
  const [y, m, d] = lt.dayKey(start).split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
  const weekday = (date.getUTCDay() + 6) % 7 // Monday = 0
  date.setUTCDate(date.getUTCDate() - weekday + 3) // Thursday of this week decides the year
  const firstThursday = new Date(Date.UTC(date.getUTCFullYear(), 0, 4))
  const week =
    1 +
    Math.round(
      ((date.getTime() - firstThursday.getTime()) / DAY_MS -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7,
    )
  return `${date.getUTCFullYear()}-W${pad(week)}`
}
