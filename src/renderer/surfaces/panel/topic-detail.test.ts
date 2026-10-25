import type { Concept, Note, Roadmap, RoadmapItem } from '@shared/domain'
import type { SubjectTree } from '@shared/state'
import { describe, expect, it } from 'vitest'
import {
  isExtracted,
  isOutlinePassage,
  isYourNote,
  sourceLabel,
  stepState,
  subtopicsOf,
  timeAgo,
  topicConceptIds,
  topicNotes,
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

  it('subtopics are the direct children, newest first, then by name', () => {
    const seen = (c: Concept, at: string | null) => ({ ...c, lastSeenAt: at })
    const cs = [
      concept('t', 'Statistical Modeling & Regression'),
      seen(concept('ols', 'Ordinary Least Squares', 't'), '2026-10-25T09:00:00.000Z'),
      seen(concept('glm', 'Generalized linear models', 't'), '2026-10-25T11:00:00.000Z'),
      seen(concept('anova', 'ANOVA', 't'), null),
      seen(concept('bias', 'Bias', 't'), null),
      concept('res', 'Residuals', 'ols'),
      concept('z', 'Other'),
    ]
    expect(subtopicsOf(cs, 't').map((c) => c.id)).toEqual(['glm', 'ols', 'anova', 'bias'])
    expect(subtopicsOf(cs, 'ols').map((c) => c.id)).toEqual(['res'])
    expect(subtopicsOf(cs, 'res')).toEqual([])
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

  it('splits the student’s own notes from the extracted ones, newest first, own concept only', () => {
    const typed = note({
      id: 'typed',
      kind: 'fact',
      source: { app: 'Dumbledore', bundleId: 'org.stuhi.dumbledore', url: null, title: null },
      createdAt: '2026-10-25T12:00:00.000Z',
    })
    const hl = note({
      id: 'hl',
      kind: 'highlight',
      encounterId: 'enc1',
      createdAt: '2026-10-25T11:00:00.000Z',
    })
    const outline = note({
      id: 'outline',
      kind: 'highlight',
      keywords: ['explains the gap'],
      createdAt: '2026-10-25T10:30:00.000Z',
    })
    const fact = note({ id: 'fact', encounterId: 'enc1' })
    const gone = note({ id: 'gone', kind: 'highlight', status: 'deleted' })
    const gap = note({ id: 'gap', kind: 'misconception' })
    const all = [typed, hl, outline, fact, gone, gap]
    expect(all.filter(isOutlinePassage).map((n) => n.id)).toEqual(['outline'])
    expect(all.filter(isYourNote).map((n) => n.id)).toEqual(['typed', 'hl'])
    expect(all.filter(isExtracted).map((n) => n.id)).toEqual(['outline', 'fact'])
    const tree = {
      subjectId: 'sub',
      concepts: [
        { concept: concept('c1', 'Topic'), notes: [fact, hl, outline] },
        { concept: concept('c2', 'Sub', 'c1'), notes: [typed] },
        { concept: concept('c9', 'Other'), notes: [note({ id: 'other', kind: 'highlight' })] },
      ],
      unplaced: [],
      edges: [],
    } as SubjectTree
    const own = topicNotes(tree, new Set(['c1']))
    expect(own.yours.map((n) => n.id)).toEqual(['hl'])
    expect(own.extracted.map((n) => n.id)).toEqual(['outline', 'fact'])
    expect(topicNotes(tree, new Set(['c2'])).yours.map((n) => n.id)).toEqual(['typed'])
    expect(topicNotes(undefined, new Set(['c1']))).toEqual({ yours: [], extracted: [] })
  })

  it('labels the source short and the time relative', () => {
    const src = (title: string | null) =>
      note({ source: { app: 'Google Chrome', bundleId: null, url: null, title } })
    expect(sourceLabel(src('Carbocation – LibreTexts'))).toBe('LibreTexts')
    expect(sourceLabel(src('ChatGPT'))).toBe('ChatGPT')
    expect(sourceLabel(src(null))).toBe('Google Chrome')
  })

  it('leaves the browser name and profile out of the source', () => {
    const src = (app: string, title: string | null) =>
      note({ source: { app, bundleId: null, url: null, title } })
    const chrome = (title: string) => sourceLabel(src('Google Chrome', title))
    expect(chrome('Regression analysis - Wikipedia - Google Chrome - Ilari (stuhi.org)')).toBe(
      'Wikipedia',
    )
    expect(chrome('Regression analysis - Wikipedia - Google Chrome')).toBe('Wikipedia')
    expect(chrome('ChatGPT - Google Chrome - Ilari (stuhi.org)')).toBe('ChatGPT')
    expect(chrome('Google Chrome - Ilari (stuhi.org)')).toBe('Google Chrome')
    expect(chrome('Safari - Wikipedia - Google Chrome - Work')).toBe('Wikipedia')
    expect(sourceLabel(src('Safari', 'Regression analysis – Wikipedia – Safari – Personal'))).toBe(
      'Wikipedia',
    )
    expect(sourceLabel(src('Safari', 'Regression analysis - Wikipedia'))).toBe('Wikipedia')
    expect(sourceLabel(src('Safari', 'Safari'))).toBe('Safari')
    expect(sourceLabel(src('Arc', 'OLS — Statsmodels - Arc'))).toBe('Statsmodels')
    expect(sourceLabel(src('Microsoft Edge', 'OLS - Statsmodels - Microsoft Edge'))).toBe(
      'Statsmodels',
    )
    expect(sourceLabel(src('Firefox', 'Regression analysis — Wikipedia — Mozilla Firefox'))).toBe(
      'Wikipedia',
    )
    const now = Date.parse('2026-10-25T12:00:00.000Z')
    expect(timeAgo('2026-10-25T11:59:40.000Z', now)).toBe('now')
    expect(timeAgo('2026-10-25T11:48:00.000Z', now)).toBe('12 min')
    expect(timeAgo('2026-10-25T07:00:00.000Z', now)).toBe('5 h')
    expect(timeAgo('2026-10-22T12:00:00.000Z', now)).toBe('3 d')
  })
})
