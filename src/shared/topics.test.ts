/** Topics shared by the panel and the tap: which ones count, their order, and the current one. */
import { describe, expect, it } from 'vitest'
import type { Concept } from './domain'
import { currentTopic, listTopics, topicSubjects } from './topics'

const concept = (
  id: string,
  subjectId: string,
  name: string,
  lastSeenAt: string | null,
  parentId: string | null = null,
): Concept => ({
  id,
  subjectId,
  parentId,
  name,
  summary: '',
  mastery: 0,
  box: 0,
  nextReviewAt: null,
  status: 'new',
  struggleCount: 0,
  lastSeenAt,
})

const subjects = [
  { id: 'stats', name: 'Statistics', status: 'active' as const },
  { id: 'orgo', name: 'Organic Chemistry', status: 'active' as const },
  { id: 'hist', name: 'History', status: 'suggested' as const },
]
const concepts = [
  concept('c1', 'stats', 'Research Methods', '2026-10-24T10:00:00Z'),
  concept('c2', 'orgo', 'SN1 mechanism', '2026-10-24T12:00:00Z'),
  concept('c3', 'orgo', 'Leaving groups', '2026-10-24T13:00:00Z', 'c2'),
  concept('c4', 'orgo', 'Solvent effects', null),
  concept('c5', 'hist', 'Tampere', '2026-10-24T14:00:00Z'),
]
const of = (id: string) => concepts.filter((c) => c.subjectId === id)

describe('topics', () => {
  it('counts active and suggested subjects, never archived ones', () => {
    const all = [...subjects, { id: 'old', name: 'Old', status: 'archived' as const }]
    expect(topicSubjects(all).map((s) => s.id)).toEqual(['stats', 'orgo', 'hist'])
  })

  it('lists top-level concepts of every counted subject, newest first, never seen last', () => {
    expect(listTopics(subjects, of).map((t) => t.name)).toEqual([
      'Tampere',
      'SN1 mechanism',
      'Research Methods',
      'Solvent effects',
    ])
  })

  it('labels a topic with its subject only when another subject has the same name', () => {
    const twins = [...concepts, concept('c6', 'stats', 'sn1 mechanism', '2026-10-23T09:00:00Z')]
    const topics = listTopics(subjects, (id) => twins.filter((c) => c.subjectId === id))
    expect(topics.find((t) => t.id === 'c2')?.subjectLabel).toBe('Organic Chemistry')
    expect(topics.find((t) => t.id === 'c6')?.subjectLabel).toBe('Statistics')
    expect(topics.find((t) => t.id === 'c1')?.subjectLabel).toBeNull()
  })

  it('the current topic is the locked one, else the newest', () => {
    const topics = listTopics(subjects, of)
    expect(currentTopic(topics, null)?.id).toBe('c5')
    expect(currentTopic(topics, 'c1')?.id).toBe('c1')
    expect(currentTopic(topics, 'gone')?.id).toBe('c5')
    expect(currentTopic([], null)).toBeNull()
  })
})
