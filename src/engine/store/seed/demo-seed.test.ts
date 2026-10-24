import { describe, expect, it } from 'vitest'
import { createMemoryRepos } from '../../testing/memory-repos'
import { createSqliteRepos } from '../sqlite-repos'
import { seedDemo } from './demo-seed'
import { ManualClock } from './manual-clock'

const NOW = Date.parse('2026-10-24T12:00:00.000Z')

describe.each([
  ['sqlite', (clock: ManualClock) => createSqliteRepos(':memory:', clock)],
  ['memory', (clock: ManualClock) => createMemoryRepos(clock)],
])('seedDemo on %s', (_name, make) => {
  it('writes the demo dataset relative to now', () => {
    const clock = new ManualClock(NOW)
    const repos = make(clock)
    const result = seedDemo(repos, clock)
    expect(clock.now()).toBe(NOW)

    const subjects = repos.subjects.list()
    expect(subjects.map((s) => `${s.emoji} ${s.name} (${s.status})`)).toEqual([
      '🧪 Organic Chemistry (active)',
      '📐 Linear Algebra (active)',
      '🌍 Geography (suggested)',
    ])
    expect(result.subjects.orgo.focus).toBe('focus')
    expect(result.subjects.orgo.deadline).toBe('2026-12-12T09:00:00.000Z')
    expect(result.counts).toEqual({
      concepts: 22,
      encounters: 25,
      quizzes: 4,
      assignments: 2,
      llmCalls: 29,
    })
    expect(repos.encounters.list({})).toHaveLength(25)
    expect(repos.encounters.list({ inboxState: 'new' })).toHaveLength(7)
    expect(repos.encounters.list({ inboxState: 'ignored' })).toHaveLength(1)

    const roadmap = repos.roadmaps.getActive(result.subjects.orgo.id)
    expect(roadmap?.items.map((i) => i.status)).toEqual([
      'done',
      'done',
      'done',
      'done',
      'current',
      'todo',
      'todo',
    ])
    expect(roadmap?.carry).toEqual(['Carbocation stability'])
    const checkpoint = roadmap?.items[3]
    expect(checkpoint?.kind === 'checkpoint' && checkpoint.score).toBeCloseTo(2 / 3)

    expect(repos.quizzes.list({ kind: 'exam' }).map((q) => q.score)).toEqual([0.7, 0.8])
    expect(repos.quizzes.list({ kind: 'review' })).toHaveLength(1)
    expect(repos.concepts.listDue(clock.nowIso(), 50).map((c) => c.name)).toEqual([
      'Chirality',
      'Determinants',
      'Leaving groups',
      'Matrix multiplication',
      'Carbocation stability',
      'Eigenvalues and eigenvectors',
    ])
    expect(repos.concepts.listStruggling(5).map((c) => c.name)).toEqual([
      'Eigenvalues and eigenvectors',
      'Carbocation stability',
    ])
    expect(repos.assignments.list({ status: 'open' })).toHaveLength(2)
    expect(repos.chat.history('coach', 10)).toHaveLength(4)
    expect(repos.profile.get().habits.promptsSeen).toBe(23)
    expect(repos.settings.get()).toMatchObject({
      onboardingDone: true,
      focusSubjectId: result.subjects.orgo.id,
    })
    expect(
      repos.usage.rowsSince('2026-10-24T11:00:00.000Z').map((r) => [r.provider, r.model, r.calls]),
    ).toEqual([
      ['apple', 'system', 12],
      ['groq', 'openai/gpt-oss-20b', 9],
      ['groq', 'openai/gpt-oss-120b', 4],
      ['ovh', 'gpt-oss-20b', 2],
    ])
  })
})
