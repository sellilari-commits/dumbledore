/** Small time helpers for read models (all times are epoch ms or ISO strings). */

export const DAY_MS = 86_400_000

export const iso = (ms: number): string => new Date(ms).toISOString()

/** Local midnight (system time zone) of the day containing `ms`. */
export function startOfLocalDay(ms: number): number {
  const d = new Date(ms)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Latest of the given ISO timestamps, or null when there are none. */
export function latestIso(values: readonly (string | null | undefined)[]): string | null {
  let best: string | null = null
  for (const v of values) if (v && (best === null || v > best)) best = v
  return best
}

const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/

/** True for a bare calendar date ("2026-12-12") as typed into a date field. */
export const isDateOnly = (value: string): boolean => DATE_ONLY.test(value)

/**
 * Epoch ms of a due date. A bare date means the end of that local day, so something due today
 * stays "upcoming" all day; full timestamps are taken as they are. NaN when unparseable.
 */
export function dueTime(value: string): number {
  const m = DATE_ONLY.exec(value)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 23, 59, 59, 999).getTime()
  return Date.parse(value)
}
