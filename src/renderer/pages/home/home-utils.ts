/**
 * Pure helpers for Home: the summary line under the greeting, deadline urgency (colour only
 * when it means something) and prompting-habit shares with a one-line tip for the weakest.
 */
import { daysUntil, formatCount } from '@renderer/lib/format'
import type { NotionColor, PromptHabits } from '@shared/domain'
import type { HomeData } from '@shared/state'

/** "Saturday, October 24". */
export function todayLabel(now = new Date()): string {
  return now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
}

/** One short sentence about what needs attention today, or null when nothing does. */
export function summaryLine(home: HomeData, now = Date.now()): string | null {
  const parts: string[] = []
  if (home.dueReviews.length > 0) parts.push(`${formatCount(home.dueReviews.length, 'review')} due`)
  const soon = home.deadlines.filter((d) => {
    const days = daysUntil(d.dueAt, now)
    return days >= 0 && days <= 7
  }).length
  if (soon > 0) parts.push(`${formatCount(soon, 'deadline')} this week`)
  if (parts.length === 0) return null
  return parts.join(' · ')
}

/** Overdue → red, due within two days → orange, otherwise no colour. */
export function dueColor(iso: string, now = Date.now()): NotionColor | null {
  const days = daysUntil(iso, now)
  if (days < 0) return 'red'
  if (days <= 2) return 'orange'
  return null
}

/** Nothing to continue, review, fix or hand in, and no study time yet (habits don't count). */
export function isFirstDay(home: HomeData): boolean {
  return (
    home.continue.length === 0 &&
    home.dueReviews.length === 0 &&
    home.struggling.length === 0 &&
    home.deadlines.length === 0 &&
    home.week.minutesBySubject.length === 0 &&
    home.week.questionsAnswered === 0
  )
}

export interface HabitRow {
  key: Exclude<keyof PromptHabits, 'promptsSeen'>
  label: string
  count: number
  share: number
  tip: string
}

const HABITS: ReadonlyArray<Omit<HabitRow, 'count' | 'share'>> = [
  {
    key: 'withContext',
    label: 'Give context',
    tip: 'Say what you already know and where you got stuck — the answer starts from there.',
  },
  {
    key: 'withStructure',
    label: 'Ask for structure',
    tip: 'Ask for numbered steps or short bullets, so the answer is easy to check.',
  },
  {
    key: 'askedForExamples',
    label: 'Ask for examples',
    tip: 'Ask for one worked example — it turns a rule into something you can picture.',
  },
  {
    key: 'askedToBeQuizzed',
    label: 'Ask to be quizzed',
    tip: 'End with “then ask me one question and wait” — recalling beats re-reading.',
  },
]

export function habitRows(h: PromptHabits): HabitRow[] {
  const seen = Math.max(0, h.promptsSeen)
  return HABITS.map((x) => ({
    ...x,
    count: h[x.key],
    share: seen > 0 ? Math.min(1, h[x.key] / seen) : 0,
  }))
}

/** The habit with the lowest share — the one worth a tip. */
export function weakestHabit(rows: HabitRow[]): HabitRow | null {
  let best: HabitRow | null = null
  for (const r of rows) if (!best || r.share < best.share) best = r
  return best
}
