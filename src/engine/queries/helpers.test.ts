/** Unit tests for the read-model helpers: progress, study minutes, struggle reasons, ranking. */
import type { Concept, Encounter, Quiz, Roadmap, SubjectSummary } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { encounterInput, quiz, roadmap } from '../store/conformance/fixtures'
import { greetingNameFrom } from './greeting'
import { pickerScore } from './picker'
import { struggleReason } from './struggle'
import { currentItemIndex, roadmapProgress, studyMinutes } from './summary'
import { dueTime, latestIso, startOfLocalDay } from './time'

const enc = (over: Partial<Encounter>): Encounter => ({
  ...encounterInput(),
  id: 'enc_x',
  inboxState: 'accepted',
  createdAt: '2026-10-24T09:00:00.000Z',
  ...over,
})

const concept = (over: Partial<Concept> = {}): Concept => ({
  id: 'con_1',
  subjectId: 'sub_1',
  parentId: null,
  name: 'SN1',
  summary: '',
  mastery: 0.3,
  box: 1,
  nextReviewAt: null,
  status: 'struggling',
  struggleCount: 0,
  lastSeenAt: null,
  ...over,
})

describe('roadmap helpers', () => {
  const r = roadmap('sub_1')
  const withStatuses = (...statuses: Roadmap['items'][number]['status'][]): Roadmap => ({
    ...r,
    items: statuses.map((status, i) => ({
      ...(r.items[i % 2] as Roadmap['items'][number]),
      status,
    })),
  })

  it('counts done and skipped items as progress; a done roadmap is complete', () => {
    expect(roadmapProgress(null)).toBe(0)
    expect(roadmapProgress(withStatuses('done', 'skipped', 'current', 'todo'))).toBe(0.5)
    expect(roadmapProgress({ ...withStatuses('done', 'todo'), status: 'done' })).toBe(1)
    expect(roadmapProgress({ ...r, items: [] })).toBe(0)
  })

  it('points at the current item, else the first to-do, else the end', () => {
    expect(currentItemIndex(withStatuses('done', 'todo', 'current'))).toBe(2)
    expect(currentItemIndex(withStatuses('done', 'todo', 'todo'))).toBe(1)
    expect(currentItemIndex(withStatuses('done', 'skipped'))).toBe(2)
  })
})

describe('studyMinutes', () => {
  it('counts each episode once and skips ignored encounters', () => {
    expect(
      studyMinutes([
        enc({ id: 'a', episodeId: 'epi_1', dwellSeconds: 360 }),
        enc({ id: 'b', episodeId: 'epi_1', dwellSeconds: 360 }),
        enc({ id: 'c', episodeId: null, dwellSeconds: 90 }),
        enc({ id: 'd', episodeId: null, dwellSeconds: 90 }),
        enc({ id: 'e', episodeId: 'epi_2', dwellSeconds: 600, inboxState: 'ignored' }),
      ]),
    ).toBe(9)
  })
})

describe('struggleReason', () => {
  const missed: Quiz = quiz({
    kind: 'checkpoint',
    title: 'Checkpoint 2',
    answers: [
      {
        questionId: 'qst_1',
        chosenIndex: 3,
        correct: false,
        answeredAt: '2026-10-24T09:00:00.000Z',
      },
      {
        questionId: 'qst_2',
        chosenIndex: 1,
        correct: true,
        answeredAt: '2026-10-24T09:01:00.000Z',
      },
    ],
  })

  it('prefers the latest quiz that tested the concept', () => {
    expect(struggleReason(concept(), [missed], [])).toBe('missed 1 of 2 in checkpoint 2')
    expect(struggleReason(concept(), [{ ...missed, kind: 'exam' }], [])).toBe(
      'missed 1 of 2 in your last exam',
    )
  })

  it('falls back to struggling evidence, then the struggle count', () => {
    const evidence = enc({
      conceptId: 'con_1',
      understanding: 'struggling',
      evidence: 'Re-read it 3×',
    })
    expect(struggleReason(concept(), [], [evidence])).toBe('Re-read it 3×')
    expect(struggleReason(concept({ struggleCount: 2 }), [], [])).toBe('struggled 2× recently')
    expect(struggleReason(concept(), [], [])).toBe('needs another look')
  })
})

describe('pickerScore', () => {
  const now = Date.parse('2026-10-24T12:00:00.000Z')
  const summary = (over: Partial<SubjectSummary>): SubjectSummary => ({
    id: 'sub_1',
    name: 'X',
    emoji: '📘',
    color: 'default',
    description: '',
    goal: null,
    deadline: null,
    status: 'active',
    focus: 'normal',
    createdAt: '',
    updatedAt: '',
    progress: 0,
    mastery: 0,
    dueReviews: 0,
    openQuestions: 0,
    studyMinutesWeek: 0,
    lastStudiedAt: null,
    ...over,
  })

  it('ranks focus over recency over struggle and due reviews, and mutes last', () => {
    const focus = pickerScore(summary({ focus: 'focus' }), 0, null, now)
    const recent = pickerScore(summary({ lastStudiedAt: '2026-10-24T11:00:00.000Z' }), 0, null, now)
    const stale = pickerScore(summary({ lastStudiedAt: '2026-10-10T11:00:00.000Z' }), 0, null, now)
    const struggling = pickerScore(summary({}), 2, null, now)
    const muted = pickerScore(summary({ focus: 'muted', dueReviews: 9 }), 3, null, now)
    expect(focus).toBeGreaterThan(recent)
    expect(recent).toBeGreaterThan(stale)
    expect(struggling).toBe(8)
    expect(muted).toBeLessThan(0)
    expect(pickerScore(summary({}), 0, 'sub_1', now)).toBe(100)
  })
})

describe('misc', () => {
  it('derives the greeting name from the account name', () => {
    expect(greetingNameFrom('ilari.stuhi')).toBe('Ilari')
    expect(greetingNameFrom('anna_k')).toBe('Anna')
    expect(greetingNameFrom('')).toBe('')
  })

  it('finds local midnight and the latest timestamp', () => {
    const ms = Date.parse('2026-10-24T15:30:00.000Z')
    const midnight = new Date(startOfLocalDay(ms))
    expect([midnight.getHours(), midnight.getMinutes()]).toEqual([0, 0])
    expect(ms - midnight.getTime()).toBeLessThan(86_400_000)
    expect(latestIso([null, '2026-01-02', undefined, '2026-01-01'])).toBe('2026-01-02')
    expect(latestIso([])).toBeNull()
  })

  it('reads bare due dates as the end of that local day', () => {
    const end = new Date(dueTime('2026-10-24'))
    expect([end.getFullYear(), end.getMonth(), end.getDate(), end.getHours()]).toEqual([
      2026, 9, 24, 23,
    ])
    expect(dueTime('2026-10-24T09:00:00.000Z')).toBe(Date.parse('2026-10-24T09:00:00.000Z'))
    expect(dueTime('soon')).toBeNaN()
  })
})
