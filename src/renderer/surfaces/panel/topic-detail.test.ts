import type { Concept, Note, Roadmap, RoadmapItem } from '@shared/domain'
import type { SubjectTree } from '@shared/state'
import { describe, expect, it } from 'vitest'
import {
  isFlag,
  sourceLabel,
  stepState,
  timeAgo,
  topicConceptIds,
  topicFlags,
  topicRoadmap,
} from './topic-detail'

const concept = (id: string, name: string, parentId: string | null = null): Concept =>
  ({ id, name, parentId, subjectId: 'sub', summary: '' }) as Concept

const learn = (over: Partial<RoadmapItem & { kind: 'learn' }> = {}): RoadmapItem =>
  ({
    kind: 'learn',
    id: 'i',
    idx: 0,
    title: 'Step',
    objective: '',
    concepts: [],
    move: 'definition',
    promptDraft: '',
    promptSent: null,
    status: 'todo',
    ...over,
  }) as RoadmapItem

const roadmap = (items: RoadmapItem[], title = 'Plan', goal = ''): Roadmap =>
  ({ id: 'rm', subjectId: 'sub', title, goal, items }) as Roadmap

const note = (over: Partial<Note>): Note =>
  ({
    id: 'n',
    subjectId: 'sub',
    conceptId: 'c1',
    encounterId: null,
    kind: 'fact',
    text: 'x',
    keywords: [],
    source: { app: 'Google Chrome', bundleId: 'com.google.Chrome', url: null, title: null },
    status: 'active',
    mergedInto: null,
    pinned: false,
    createdAt: '2026-10-25T10:00:00.000Z',
    updatedAt: '2026-10-25T10:00:00.000Z',
    ...over,
  }) as Note

describe('topic detail read model', () => {
  it('collects the topic and every concept under it', () => {
    const cs = [
      concept('t', 'Topic'),
      concept('a', 'A', 't'),
      concept('b', 'B', 'a'),
      concept('z', 'Z'),
    ]
    expect([...topicConceptIds(cs, 't')].sort()).toEqual(['a', 'b', 't'])
  })

  it('finds the roadmap that teaches the topic or a subtopic, else none', () => {
    const rm = roadmap([learn({ concepts: ['Hyperconjugation'] })])
    expect(topicRoadmap(rm, 'Carbocation stability', ['Hyperconjugation'])).toBe(rm)
    expect(topicRoadmap(rm, 'Solvent effects', [])).toBeNull()
    expect(
      topicRoadmap(roadmap([], 'Solvent effects in SN1'), 'solvent effects', []),
    ).not.toBeNull()
    expect(topicRoadmap(null, 'Any', [])).toBeNull()
  })

  it('marks a step done only when answered; a sent step waits for the answer', () => {
    expect(stepState(learn({ status: 'done' }))).toBe('done')
    expect(stepState(learn({ status: 'current', promptSent: 'sent' }))).toBe('waiting')
    expect(stepState(learn({ status: 'current' }))).toBe('current')
    expect(stepState(learn({ status: 'skipped' }))).toBe('skipped')
    expect(stepState(learn())).toBe('upcoming')
  })

  it('flags are highlights and typed notes, newest first', () => {
    const typed = note({
      id: 'typed',
      kind: 'fact',
      source: { app: 'Dumbledore', bundleId: 'org.stuhi.dumbledore', url: null, title: null },
      createdAt: '2026-10-25T12:00:00.000Z',
    })
    const hl = note({ id: 'hl', kind: 'highlight', createdAt: '2026-10-25T11:00:00.000Z' })
    const fact = note({ id: 'fact' })
    const gone = note({ id: 'gone', kind: 'highlight', status: 'deleted' })
    expect([typed, hl, fact, gone].filter(isFlag).map((n) => n.id)).toEqual(['typed', 'hl'])
    const tree = {
      subjectId: 'sub',
      concepts: [
        { concept: concept('c1', 'Topic'), notes: [hl, fact] },
        { concept: concept('c2', 'Sub', 'c1'), notes: [typed] },
        { concept: concept('c9', 'Other'), notes: [note({ id: 'other', kind: 'highlight' })] },
      ],
      unplaced: [],
      edges: [],
    } as SubjectTree
    expect(topicFlags(tree, new Set(['c1', 'c2'])).map((n) => n.id)).toEqual(['typed', 'hl'])
    expect(topicFlags(undefined, new Set(['c1']))).toEqual([])
  })

  it('labels the source short and the time relative', () => {
    const src = (title: string | null) =>
      note({ source: { app: 'Google Chrome', bundleId: null, url: null, title } })
    expect(sourceLabel(src('Carbocation – LibreTexts'))).toBe('LibreTexts')
    expect(sourceLabel(src('ChatGPT'))).toBe('ChatGPT')
    expect(sourceLabel(src(null))).toBe('Google Chrome')
    const now = Date.parse('2026-10-25T12:00:00.000Z')
    expect(timeAgo('2026-10-25T11:59:40.000Z', now)).toBe('just now')
    expect(timeAgo('2026-10-25T11:48:00.000Z', now)).toBe('12 min ago')
    expect(timeAgo('2026-10-25T07:00:00.000Z', now)).toBe('5 h ago')
    expect(timeAgo('2026-10-22T12:00:00.000Z', now)).toBe('3 d ago')
  })
})
