/** Time helpers for the mock's demo data: everything is placed relative to "now". */

export const MINUTE = 60_000
export const HOUR = 60 * MINUTE
export const DAY = 24 * HOUR

export function isoAgo(ms: number): string {
  return new Date(Date.now() - ms).toISOString()
}

export function isoIn(ms: number): string {
  return new Date(Date.now() + ms).toISOString()
}

/** A day offset from today at a fixed local hour (deadlines, reviews). */
export function isoDayAt(dayOffset: number, hour: number, minute = 0): string {
  const d = new Date()
  d.setDate(d.getDate() + dayOffset)
  d.setHours(hour, minute, 0, 0)
  return d.toISOString()
}

export function nowIso(): string {
  return new Date().toISOString()
}

let seq = 0
export function mockId(prefix: string): string {
  seq += 1
  return `${prefix}_${Date.now().toString(36)}${seq.toString(36)}`
}
