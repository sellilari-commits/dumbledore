import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { buildPicker, summarizeSubject } from './picker'
import { createHarness, seedEncounter, seedSubject } from './test-helpers'

describe('picker', () => {
  it('ranks by focus, recent encounters, struggling concepts and due reviews', () => {
    const clock = new FakeClock('2026-10-24T09:00:00.000Z')
    const repos = createMemoryRepos(clock)
    const due = seedSubject(repos, 'Due Reviews')
    const struggling = seedSubject(repos, 'Struggling')
    const recent = seedSubject(repos, 'Recent Reading')
    seedSubject(repos, 'Focus', { focus: 'focus' })
    const suggested = seedSubject(repos, 'Suggested Idea', { status: 'suggested' })
    const muted = seedSubject(repos, 'Muted', { focus: 'muted' })
    seedSubject(repos, 'Archived', { status: 'archived' })

    for (let i = 0; i < 5; i++)
      seedEncounter(repos, recent.id, { openQuestions: [`Question ${i}?`] })
    for (let i = 0; i < 6; i++) seedEncounter(repos, muted.id)
    for (const name of ['A', 'B', 'C']) {
      const c = repos.concepts.upsert({ subjectId: struggling.id, name })
      repos.concepts.update(c.id, { status: 'struggling', struggleCount: 2 })
    }
    for (const name of ['D', 'E']) {
      const c = repos.concepts.upsert({ subjectId: due.id, name })
      repos.concepts.update(c.id, { nextReviewAt: '2026-10-23T09:00:00.000Z', mastery: 0.5 })
    }

    const picker = buildPicker(repos, clock.nowIso())
    expect(picker.subjects.map((s) => s.subject.name)).toEqual([
      'Focus',
      'Recent Reading',
      'Struggling',
      'Due Reviews',
      'Suggested Idea',
      'Muted',
    ])
    const recentRow = picker.subjects[1]
    expect(recentRow?.questions).toHaveLength(3)
    expect(recentRow?.subject).toMatchObject({ openQuestions: 5, studyMinutesWeek: 10 })
    expect(picker.subjects[3]?.subject).toMatchObject({ dueReviews: 2, mastery: 0.5 })
    expect(picker.subjects.every((s) => !s.hasActiveRoadmap)).toBe(true)
    expect(suggested.status).toBe('suggested')
  })

  it('older encounters count for less, and the settings focus subject counts as focus', () => {
    const clock = new FakeClock('2026-10-20T09:00:00.000Z')
    const repos = createMemoryRepos(clock)
    const old = seedSubject(repos, 'Old')
    const fresh = seedSubject(repos, 'Fresh')
    const pinned = seedSubject(repos, 'Pinned')
    for (let i = 0; i < 4; i++) seedEncounter(repos, old.id)
    clock.set('2026-10-24T08:00:00.000Z')
    for (let i = 0; i < 2; i++) seedEncounter(repos, fresh.id)
    repos.settings.update({ focusSubjectId: pinned.id })
    const names = buildPicker(repos, clock.nowIso()).subjects.map((s) => s.subject.name)
    expect(names).toEqual(['Pinned', 'Fresh', 'Old'])
  })

  it('reports roadmap progress and hasActiveRoadmap through the service', async () => {
    const h = createHarness()
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      {
        assistant: 'ChatGPT',
        chatExcerpt: '',
        pageContext: '',
      },
    )
    await h.service.next({ assistant: 'ChatGPT', chatExcerpt: '', pageContext: '' })
    const [row] = h.service.picker().subjects
    expect(row?.hasActiveRoadmap).toBe(true)
    expect(row?.subject.progress).toBeCloseTo(1 / 5)
    expect(summarizeSubject(h.repos, subject, h.clock.nowIso()).lastStudiedAt).toBe(
      h.clock.nowIso(),
    )
  })
})
