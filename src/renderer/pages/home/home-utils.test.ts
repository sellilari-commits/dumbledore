/** Home helpers: deadline colours, the summary line, habit shares and the first-day check. */
import type { HomeData } from '@shared/state'
import { describe, expect, it } from 'vitest'
import { dueColor, habitRows, isFirstDay, summaryLine, weakestHabit } from './home-utils'

const NOW = new Date('2026-10-24T18:00:00').getTime()
const at = (days: number) => new Date(NOW + days * 86_400_000).toISOString()

const empty: HomeData = {
  greetingName: 'Ilari',
  continue: [],
  dueReviews: [],
  struggling: [],
  deadlines: [],
  week: { minutesBySubject: [], questionsAnswered: 0, accuracy: null },
  habits: {
    promptsSeen: 0,
    withContext: 0,
    withStructure: 0,
    askedToBeQuizzed: 0,
    askedForExamples: 0,
  },
}

describe('home-utils', () => {
  it('colours deadlines only when they mean something', () => {
    expect(dueColor(at(-1), NOW)).toBe('red')
    expect(dueColor(at(0), NOW)).toBe('orange')
    expect(dueColor(at(2), NOW)).toBe('orange')
    expect(dueColor(at(3), NOW)).toBeNull()
  })

  it('summarises reviews and this week’s deadlines', () => {
    expect(summaryLine(empty, NOW)).toBeNull()
    const home: HomeData = {
      ...empty,
      dueReviews: [{ conceptId: 'c1', conceptName: 'A', subjectId: 's', subjectEmoji: '🧪' }],
      deadlines: [
        {
          id: 'a',
          title: 'PS4',
          dueAt: at(6),
          kind: 'assignment',
          subjectId: null,
          subjectEmoji: null,
        },
        {
          id: 'b',
          title: 'Midterm',
          dueAt: at(40),
          kind: 'subject',
          subjectId: 's',
          subjectEmoji: '🧪',
        },
      ],
    }
    expect(summaryLine(home, NOW)).toBe('1 review due · 1 deadline this week')
  })

  it('computes habit shares and picks the weakest', () => {
    const rows = habitRows({
      promptsSeen: 64,
      withContext: 22,
      withStructure: 31,
      askedToBeQuizzed: 9,
      askedForExamples: 27,
    })
    expect(rows.map((r) => Math.round(r.share * 100))).toEqual([34, 48, 42, 14])
    expect(weakestHabit(rows)?.key).toBe('askedToBeQuizzed')
    expect(habitRows(empty.habits).every((r) => r.share === 0)).toBe(true)
  })

  it('treats a page with nothing to act on as the first day', () => {
    expect(isFirstDay(empty)).toBe(true)
    expect(isFirstDay({ ...empty, week: { ...empty.week, questionsAnswered: 3 } })).toBe(false)
  })
})
