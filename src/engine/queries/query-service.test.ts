/** QueryService on the demo dataset, against both Repos implementations. */
import { beforeEach, describe, expect, it } from 'vitest'
import type { QueryService, Repos } from '../contracts'
import { type DemoSeedResult, seedDemo } from '../store/seed/demo-seed'
import { ManualClock } from '../store/seed/manual-clock'
import { createSqliteRepos } from '../store/sqlite-repos'
import { createMemoryRepos } from '../testing/memory-repos'
import { createQueryService } from './query-service'
import { DAY_MS } from './time'

const NOW = Date.parse('2026-10-24T12:00:00.000Z')
const H = 3_600_000
const utcMidnight = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS

describe.each([
  ['sqlite', (clock: ManualClock): Repos => createSqliteRepos(':memory:', clock)],
  ['memory', (clock: ManualClock): Repos => createMemoryRepos(clock)],
])('QueryService on seeded data (%s)', (_name, make) => {
  let repos: Repos
  let seed: DemoSeedResult
  let q: QueryService

  beforeEach(() => {
    const clock = new ManualClock(NOW)
    repos = make(clock)
    seed = seedDemo(repos, clock)
    q = createQueryService({ repos, clock, greetingName: 'Ilari', startOfDay: utcMidnight })
  })

  it('builds Home: continue, due, struggling, deadlines, this week, habits', () => {
    const home = q.home()
    const { orgo, la } = seed.subjects
    expect(home.greetingName).toBe('Ilari')
    expect(home.continue).toEqual([
      {
        roadmapId: seed.roadmapId,
        subjectId: orgo.id,
        subjectName: 'Organic Chemistry',
        subjectEmoji: '🧪',
        title: 'SN1 vs SN2: when does each happen?',
        index: 4,
        total: 7,
      },
    ])
    expect(home.dueReviews.map((d) => `${d.subjectEmoji} ${d.conceptName}`)).toEqual([
      '🧪 Chirality',
      '📐 Determinants',
      '🧪 Leaving groups',
      '📐 Matrix multiplication',
      '🧪 Carbocation stability',
      '📐 Eigenvalues and eigenvectors',
    ])
    expect(home.struggling.map((s) => [s.conceptName, s.reason])).toEqual([
      ['Eigenvalues and eigenvectors', 'missed 1 of 1 in your last exam'],
      ['Carbocation stability', 'missed 1 of 1 in checkpoint 1'],
    ])
    expect(home.deadlines.map((d) => [d.kind, d.title, d.subjectEmoji])).toEqual([
      ['assignment', 'Problem Set 5: SN1/SN2', '🧪'],
      ['assignment', 'Linear Algebra Homework 3', '📐'],
      ['subject', 'Organic Chemistry · Pass the midterm', '🧪'],
    ])
    expect(home.week.minutesBySubject).toEqual([
      { subjectId: orgo.id, name: 'Organic Chemistry', emoji: '🧪', minutes: 91 },
      { subjectId: la.id, name: 'Linear Algebra', emoji: '📐', minutes: 82 },
    ])
    expect(home.week.questionsAnswered).toBe(21)
    expect(home.week.accuracy).toBeCloseTo(15 / 21)
    expect(home.habits.promptsSeen).toBe(23)
  })

  it('keeps a roadmap on Continue after its session ends (parked), and drops it once done', () => {
    const roadmap = repos.roadmaps.get(seed.roadmapId)
    if (!roadmap) throw new Error('seed roadmap missing')
    repos.roadmaps.save({ ...roadmap, status: 'paused' })
    expect(q.home().continue.map((c) => c.roadmapId)).toEqual([seed.roadmapId])
    repos.roadmaps.save({ ...roadmap, status: 'done' })
    expect(q.home().continue).toEqual([])
  })

  it('keeps bare-date deadlines due today and drops past ones', () => {
    repos.assignments.upsert({
      subjectId: null,
      title: 'Lab report',
      dueAt: '2026-10-24',
      source: 'm',
    })
    repos.assignments.upsert({
      subjectId: null,
      title: 'Old essay',
      dueAt: '2026-10-20',
      source: 'm',
    })
    const titles = q.home().deadlines.map((d) => d.title)
    expect(titles[0]).toBe('Lab report')
    expect(titles).not.toContain('Old essay')
  })

  it('summarises every subject', () => {
    const rows = q.subjects().map((s) => ({
      name: s.name,
      progress: Number(s.progress.toFixed(3)),
      mastery: Number(s.mastery.toFixed(4)),
      dueReviews: s.dueReviews,
      openQuestions: s.openQuestions,
      studyMinutesWeek: s.studyMinutesWeek,
      lastStudiedAt: s.lastStudiedAt,
    }))
    expect(rows).toEqual([
      {
        name: 'Organic Chemistry',
        progress: 0.571,
        mastery: 0.4825,
        dueReviews: 3,
        openQuestions: 7,
        studyMinutesWeek: 91,
        lastStudiedAt: new Date(NOW - 2 * H).toISOString(),
      },
      {
        name: 'Linear Algebra',
        progress: 0,
        mastery: 0.47,
        dueReviews: 3,
        openQuestions: 4,
        studyMinutesWeek: 82,
        lastStudiedAt: new Date(NOW - 5 * H).toISOString(),
      },
      {
        name: 'Geography',
        progress: 0,
        mastery: 0.05,
        dueReviews: 0,
        openQuestions: 1,
        studyMinutesWeek: 14,
        lastStudiedAt: new Date(NOW - 20 * H).toISOString(),
      },
    ])
  })

  it('builds a subject page and rejects unknown subjects', () => {
    const detail = q.subject(seed.subjects.orgo.id)
    expect(detail.subject.name).toBe('Organic Chemistry')
    expect(detail.roadmap?.id).toBe(seed.roadmapId)
    expect(detail.concepts).toHaveLength(12)
    expect(detail.encounters).toHaveLength(12)
    expect(detail.encounters.every((e) => e.inboxState !== 'ignored')).toBe(true)
    expect(detail.exams.map((e) => [e.kind, e.questionCount])).toEqual([
      ['review', 3],
      ['exam', 10],
    ])
    expect(detail.assignments.map((a) => a.title)).toEqual(['Problem Set 5: SN1/SN2'])
    expect(() => q.subject('sub_missing')).toThrow(/not found/)
  })

  it('lists the inbox and exams', () => {
    expect(q.inbox({ state: 'new', subjectId: null })).toHaveLength(7)
    expect(q.inbox({ state: null, subjectId: seed.subjects.la.id })).toHaveLength(8)
    expect(q.inbox({ state: 'ignored', subjectId: null }).map((e) => e.source.title)).toEqual([
      'r/chemistry',
    ])
    expect(q.exams().map((e) => [e.title, e.questionCount, e.score])).toEqual([
      ['5-min review · Leaving groups & Determinants', 3, 2 / 3],
      ['Weak-spots exam · Organic Chemistry', 10, 0.7],
      ['Everything so far · Linear Algebra', 5, 0.8],
    ])
  })

  it('searches across subjects, concepts, encounters and exams', () => {
    const hits = q.search('carbocation')
    expect(hits.filter((h) => h.kind === 'concept').map((h) => h.title)).toEqual([
      'SN1 mechanism',
      'Carbocation stability',
    ])
    expect(new Set(hits.map((h) => h.kind))).toEqual(new Set(['concept', 'encounter']))
    expect(q.search('weak-spots').map((h) => h.kind)).toEqual(['exam'])
    expect(q.search('')).toEqual([])
  })

  it("reports today's usage with free-tier limits", () => {
    const usage = q.usage()
    expect(usage.rows.map((r) => [r.provider, r.model, r.calls, r.failures])).toEqual([
      ['apple', 'system', 12, 0],
      ['groq', 'openai/gpt-oss-20b', 9, 0],
      ['groq', 'openai/gpt-oss-120b', 4, 1],
      ['ovh', 'gpt-oss-20b', 2, 0],
    ])
    expect(usage.limits).toContainEqual({
      provider: 'groq',
      model: 'openai/gpt-oss-120b',
      requestsPerDay: 1000,
      tokensPerDay: 200_000,
    })
    expect(usage.limits).toContainEqual({
      provider: 'apple',
      model: 'system',
      requestsPerDay: null,
      tokensPerDay: null,
    })
  })

  it('ranks the picker: focus first, with open questions and roadmap flags', () => {
    const picker = q.picker()
    expect(
      picker.subjects.map((p) => [p.subject.name, p.questions.length, p.hasActiveRoadmap]),
    ).toEqual([
      ['Organic Chemistry', 3, true],
      ['Linear Algebra', 3, false],
    ])
    expect(picker.subjects[0]?.questions[0]).toBe(
      'How does hyperconjugation stabilise a carbocation?',
    )
    repos.subjects.update(seed.subjects.orgo.id, { focus: 'normal' })
    repos.settings.update({ focusSubjectId: seed.subjects.la.id })
    expect(q.picker().subjects.map((p) => p.subject.name)).toEqual([
      'Linear Algebra',
      'Organic Chemistry',
    ])
  })
})
