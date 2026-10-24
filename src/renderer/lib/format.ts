/** Small, locale-stable formatters for dates, durations and percentages in the UI. */

const MIN = 60_000
const DAY = 24 * 60 * MIN

function startOfDay(t: number): number {
  const d = new Date(t)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

/** Whole calendar days from today to the date (negative = past). */
export function daysUntil(iso: string, now = Date.now()): number {
  return Math.round((startOfDay(new Date(iso).getTime()) - startOfDay(now)) / DAY)
}

/** "Dec 12" (adds the year when it is not this year). */
export function formatDate(iso: string, now = Date.now()): string {
  const d = new Date(iso)
  const sameYear = d.getFullYear() === new Date(now).getFullYear()
  return d.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  })
}

export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
}

/** "just now", "6 min ago", "3 h ago", "Yesterday", "4 days ago", then a date. */
export function formatRelative(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const diff = now - new Date(iso).getTime()
  if (diff < MIN) return 'just now'
  if (diff < 60 * MIN) return `${Math.floor(diff / MIN)} min ago`
  const days = -daysUntil(iso, now)
  if (days === 0) return `${Math.floor(diff / (60 * MIN))} h ago`
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days} days ago`
  return formatDate(iso, now)
}

/** "Today", "Tomorrow", "in 6 days", "Dec 12 · in 7 weeks", "2 days ago". */
export function formatDue(iso: string | null, now = Date.now()): string {
  if (!iso) return 'No date'
  const days = daysUntil(iso, now)
  if (days === 0) return 'Today'
  if (days === 1) return 'Tomorrow'
  if (days === -1) return 'Yesterday'
  if (days < 0) return `${-days} days ago`
  if (days < 14) return `in ${days} days`
  return `${formatDate(iso, now)} · in ${Math.round(days / 7)} weeks`
}

/** "2 h 40 min", "45 min", "0 min". */
export function formatMinutes(minutes: number): string {
  const m = Math.round(minutes)
  if (m < 60) return `${m} min`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest ? `${h} h ${rest} min` : `${h} h`
}

export function formatSeconds(seconds: number): string {
  if (seconds < 60) return `${Math.max(1, Math.round(seconds))} s`
  return formatMinutes(seconds / 60)
}

export function formatPercent(x: number | null | undefined): string {
  if (x === null || x === undefined || Number.isNaN(x)) return '—'
  return `${Math.round(x * 100)}%`
}

export function formatCount(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1000) return `${Math.round(n / 100) / 10}K`
  return String(n)
}

/** Time-of-day greeting for Home. */
export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

/** Host of a URL without "www.", or null. */
export function hostOf(url: string | null): string | null {
  if (!url) return null
  try {
    return new URL(url).host.replace(/^www\./, '')
  } catch {
    return null
  }
}
