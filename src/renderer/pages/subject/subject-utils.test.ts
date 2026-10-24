/** Subject page helpers: concept sorting, day grouping, the Status property, roadmap progress. */
import type { Concept, Encounter, Roadmap, SubjectSummary } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { groupByDay, isView, roadmapProgress, sortConcepts, subjectStatus } from './subject-utils'

const NOW = new Date('2026-10-24T15:00:00').getTime()
const DAY = 86_400_000

function concept(name: string, over: Partial<Concept> = {}): Concept {
  return {
    id: `con_${name}`,
    subjectId: 'sub',
    parentId: null,
    name,
    summary: '',
    mastery: 0.5,
    box: 1,
    nextReviewAt: null,
    status: 'learning',
    struggleCount: 0,
    lastSeenAt: null,
    ...over,
  }
}

describe('sortConcepts', () => {
  const list = [
    concept('b', { mastery: 0.9, lastSeenAt: new Date(NOW - DAY).toISOString() }),
    concept('a', { mastery: 0.2, status: 'struggling' }),
    concept('c', { mastery: 0.2, lastSeenAt: new Date(NOW).toISOString() }),
  ]
  const names = (sorted: Concept[]) => sorted.map((c) => c.name)

  it('sorts by mastery with name as the tie-break', () => {
    expect(names(sortConcepts(list, { key: 'mastery', dir: 'asc' }))).toEqual(['a', 'c', 'b'])
    expect(names(sortConcepts(list, { key: 'mastery', dir: 'desc' }))).toEqual(['b', 'a', 'c'])
  })

  it('keeps empty dates last in both directions', () => {
    expect(names(sortConcepts(list, { key: 'lastSeen', dir: 'desc' }))).toEqual(['c', 'b', 'a'])
    expect(names(sortConcepts(list, { key: 'lastSeen', dir: 'asc' }))).toEqual(['b', 'c', 'a'])
  })

  it('puts struggling first when sorting by status', () => {
    expect(names(sortConcepts(list, { key: 'status', dir: 'asc' }))[0]).toBe('a')
  })
})

describe('groupByDay', () => {
  const enc = (id: string, ago: number) =>
    ({ id, createdAt: new Date(NOW - ago).toISOString() }) as Encounter
  it('labels Today, Yesterday and older days', () => {
    const groups = groupByDay(
      [enc('1', 60_000), enc('2', 2 * 3_600_000), enc('3', DAY), enc('4', 9 * DAY)],
      NOW,
    )
    expect(groups.map((g) => g.label.split(',')[0])).toEqual(['Today', 'Yesterday', 'Oct 15'])
    expect(groups[0]?.items.map((e) => e.id)).toEqual(['1', '2'])
  })
})

describe('subjectStatus and roadmapProgress', () => {
  const s = { status: 'active', mastery: 0.5 } as SubjectSummary
  it('derives the Status property', () => {
    expect(subjectStatus(s, []).label).toBe('New')
    expect(subjectStatus(s, [concept('x')]).label).toBe('Learning')
    expect(subjectStatus({ ...s, mastery: 0.85 }, [concept('x')]).label).toBe('Mastered')
    expect(subjectStatus({ ...s, status: 'suggested' }, []).label).toBe('Suggested')
  })

  it('counts steps', () => {
    const items = ['done', 'done', 'current', 'todo'].map((status) => ({
      status,
    })) as Roadmap['items']
    expect(roadmapProgress({ items } as Roadmap)).toEqual({ done: 2, total: 4, step: 3 })
  })

  it('knows the views', () => {
    expect(isView('seen')).toBe(true)
    expect(isView('nope')).toBe(false)
    expect(isView(undefined)).toBe(false)
  })
})
