import type { Concept } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { studyOrder, treeOrder } from './order'

const concept = (id: string, over: Partial<Concept> = {}): Concept => ({
  id,
  subjectId: 'sub_1',
  parentId: null,
  name: id.toUpperCase(),
  summary: '',
  mastery: 0,
  box: 0,
  nextReviewAt: null,
  status: 'new',
  struggleCount: 0,
  lastSeenAt: null,
  ...over,
})
const names = (cs: Concept[]) => cs.map((c) => c.id)

describe('studyOrder', () => {
  it('puts emphasised concepts first, after their own prerequisites, and leaves out excluded ones', () => {
    const concepts = [
      concept('atoms'),
      concept('bonds'),
      concept('carbocation'),
      concept('sn1'),
      concept('sn2'),
    ]
    const edges = [
      { fromId: 'carbocation', toId: 'sn1' },
      { fromId: 'atoms', toId: 'bonds' },
    ]
    expect(names(studyOrder({ concepts, edges }))).toEqual([
      'atoms',
      'bonds',
      'carbocation',
      'sn1',
      'sn2',
    ])
    expect(
      names(
        studyOrder({
          concepts,
          edges,
          emphasise: new Set(['sn1']),
          exclude: new Set(['sn2']),
        }),
      ),
    ).toEqual(['carbocation', 'sn1', 'atoms', 'bonds'])
  })

  it('puts prerequisites first, the tree order breaking ties', () => {
    const concepts = [
      concept('topic'),
      concept('sn2', { parentId: 'topic' }),
      concept('sn1', { parentId: 'topic' }),
      concept('carbocation'),
    ]
    const edges = [{ fromId: 'carbocation', toId: 'sn1' }]
    expect(names(treeOrder(concepts))).toEqual(['topic', 'sn2', 'sn1', 'carbocation'])
    expect(names(studyOrder({ concepts, edges }))).toEqual(['topic', 'sn2', 'carbocation', 'sn1'])
  })

  it('skips mastered concepts and pure topic containers, but keeps their order effect', () => {
    const concepts = [
      concept('topic'),
      concept('atoms', { parentId: 'topic', status: 'mastered', mastery: 0.9 }),
      concept('bonds', { parentId: 'topic', mastery: 0.86 }),
      concept('molecules', { parentId: 'topic', status: 'learning', mastery: 0.4 }),
    ]
    const edges = [
      { fromId: 'atoms', toId: 'bonds' },
      { fromId: 'bonds', toId: 'molecules' },
    ]
    const noteCounts = new Map([['molecules', 2]])
    expect(names(studyOrder({ concepts, edges, noteCounts }))).toEqual(['molecules'])
    // Without note counts a topic is still taught.
    expect(names(studyOrder({ concepts, edges }))).toEqual(['topic', 'molecules'])
  })

  it('never drops a concept on a cycle or an unknown edge, and honours exclusions', () => {
    const concepts = [concept('a'), concept('b'), concept('c')]
    const edges = [
      { fromId: 'a', toId: 'b' },
      { fromId: 'b', toId: 'a' },
      { fromId: 'x', toId: 'c' },
    ]
    expect(names(studyOrder({ concepts, edges })).sort()).toEqual(['a', 'b', 'c'])
    expect(names(studyOrder({ concepts, edges: [], exclude: new Set(['b']) }))).toEqual(['a', 'c'])
  })
})
