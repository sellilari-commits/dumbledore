import type { Concept, SubjectSummary } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { panelSubjects, pickSubject, topicsOf } from './topics'

const subject = (
  id: string,
  status: SubjectSummary['status'],
  lastStudiedAt: string | null,
  updatedAt = '2026-10-01T00:00:00.000Z',
): SubjectSummary => ({
  id,
  name: id,
  emoji: '📘',
  color: 'default',
  description: '',
  goal: null,
  deadline: null,
  status,
  focus: 'normal',
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt,
  progress: 0,
  mastery: 0,
  dueReviews: 0,
  openQuestions: 0,
  studyMinutesWeek: 0,
  lastStudiedAt,
})

const concept = (id: string, parentId: string | null, lastSeenAt: string | null): Concept => ({
  id,
  subjectId: 'sub',
  parentId,
  name: id,
  summary: '',
  mastery: 0,
  box: 0,
  nextReviewAt: null,
  status: 'new',
  struggleCount: 0,
  lastSeenAt,
})

describe('pickSubject', () => {
  const chem = subject('chem', 'active', '2026-10-24T10:00:00.000Z')
  const stats = subject('stats', 'active', '2026-10-24T12:00:00.000Z')
  const geo = subject('geo', 'suggested', '2026-10-24T13:00:00.000Z')

  it('prefers the focus subject', () => {
    expect(pickSubject([chem, stats, geo], 'chem')).toBe(chem)
    expect(pickSubject([chem, stats, geo], 'geo')).toBe(geo)
  })

  it('else takes the active subject with the newest information', () => {
    expect(pickSubject([chem, stats, geo], null)).toBe(stats)
    expect(pickSubject([chem, stats, geo], 'gone')).toBe(stats)
  })

  it('falls back to updatedAt, and to suggested subjects when none is active', () => {
    const fresh = subject('fresh', 'suggested', null, '2026-10-24T14:00:00.000Z')
    expect(pickSubject([geo, fresh], null)).toBe(fresh)
    expect(panelSubjects([geo, fresh])).toEqual([geo, fresh])
    expect(pickSubject([], null)).toBeNull()
    expect(pickSubject([subject('old', 'archived', '2026-10-24T15:00:00.000Z')], null)).toBeNull()
  })
})

describe('topicsOf', () => {
  it('keeps the level under the subject, newest first, never-seen last', () => {
    const topics = topicsOf([
      concept('b', null, '2026-10-24T09:00:00.000Z'),
      concept('child', 'b', '2026-10-24T11:00:00.000Z'),
      concept('a', null, '2026-10-24T10:00:00.000Z'),
      concept('orphan', 'missing', null),
      concept('c', null, null),
    ])
    expect(topics.map((c) => c.id)).toEqual(['a', 'b', 'c', 'orphan'])
  })
})
