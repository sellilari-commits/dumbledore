/** FeedbackRepo on SQLite and on the in-memory twin: add, scoped recent (newest first), remove. */
import { describe, expect, it } from 'vitest'
import type { Repos } from '../contracts'
import { FakeClock } from '../clock'
import { createMemoryRepos } from '../testing/memory-repos'
import { LATEST_SCHEMA_VERSION } from './migrations'
import { createSqliteRepos } from './sqlite-repos'

const targets: [string, () => Repos][] = [
  ['sqlite', () => createSqliteRepos(':memory:', new FakeClock())],
  ['memory', () => createMemoryRepos(new FakeClock())],
]

describe.each(targets)('FeedbackRepo (%s)', (_name, make) => {
  it('adds trimmed feedback and lists it newest first, filtered by scope', () => {
    const repos = make()
    const chem = repos.subjects.create({ name: 'Chemistry' })
    const a = repos.feedback.add({ scope: 'quizzes', subjectId: null, text: '  Too easy  ' })
    repos.feedback.add({ scope: 'prompts', subjectId: chem.id, text: 'Shorter prompts' })
    const c = repos.feedback.add({ scope: 'general', subjectId: null, text: 'Be blunt' })
    expect(a).toMatchObject({ id: expect.stringMatching(/^fbk_/), text: 'Too easy', scope: 'quizzes' })
    expect(repos.feedback.recent({ limit: 10 }).map((f) => f.text)).toEqual([
      'Be blunt',
      'Shorter prompts',
      'Too easy',
    ])
    expect(
      repos.feedback.recent({ scopes: ['quizzes', 'general'], limit: 10 }).map((f) => f.id),
    ).toEqual([c.id, a.id])
    expect(repos.feedback.recent({ limit: 1 })).toHaveLength(1)
  })

  it('cuts long feedback, refuses empty text, and removes by id', () => {
    const repos = make()
    const long = repos.feedback.add({ scope: 'memory', subjectId: null, text: 'x'.repeat(400) })
    expect(long.text).toHaveLength(300)
    expect(() => repos.feedback.add({ scope: 'memory', subjectId: null, text: '   ' })).toThrow()
    repos.feedback.remove(long.id)
    expect(repos.feedback.recent({ limit: 5 })).toEqual([])
  })
})

it('schema v4 adds the feedback table', () => {
  expect(LATEST_SCHEMA_VERSION).toBeGreaterThanOrEqual(4)
})
