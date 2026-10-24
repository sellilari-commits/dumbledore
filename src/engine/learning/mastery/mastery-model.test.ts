import { FakeClock } from '@engine/clock'
import { fixedOffsetLocalTime } from '@engine/scheduler/local-time'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { describe, expect, it } from 'vitest'
import { createMasteryModel } from './mastery-model'

function setup() {
  const clock = new FakeClock('2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const model = createMasteryModel({ repos, localTime: fixedOffsetLocalTime(0) })
  const subject = repos.subjects.create({ name: 'Organic Chemistry' })
  const concept = repos.concepts.upsert({ subjectId: subject.id, name: 'SN1' })
  return { clock, repos, model, subject, concept }
}

describe('MasteryModel', () => {
  it('persists mastery, box, next review, status and last seen for answers', () => {
    const { clock, repos, model, concept } = setup()
    const updated = model.applyAnswer(concept.id, true, 2, clock.nowIso())
    expect(updated).toMatchObject({
      mastery: 0.3,
      box: 1,
      nextReviewAt: '2026-10-25T04:00:00.000Z',
      status: 'learning',
      struggleCount: 0,
      lastSeenAt: '2026-10-24T09:00:00.000Z',
    })
    expect(repos.concepts.get(concept.id)).toEqual(updated)

    const missed = model.applyAnswer(concept.id, false, 2, clock.nowIso())
    expect(missed).toMatchObject({ mastery: 0.18, box: 1, status: 'struggling', struggleCount: 1 })
    expect(repos.concepts.listStruggling(5).map((c) => c.id)).toEqual([concept.id])
  })

  it('keeps the latest last-seen time when answers arrive out of order', () => {
    const { model, concept } = setup()
    model.applyAnswer(concept.id, true, 2, '2026-10-24T10:00:00.000Z')
    const c = model.applyAnswer(concept.id, true, 2, '2026-10-24T09:30:00.000Z')
    expect(c.lastSeenAt).toBe('2026-10-24T10:00:00.000Z')
  })

  it('applies encounters: struggle flag, small reading gains', () => {
    const { clock, model, concept } = setup()
    const read = model.applyEncounter(concept.id, 'understood', clock.nowIso())
    expect(read.mastery).toBeCloseTo(0.05)
    expect(read.status).toBe('new')
    expect(read.box).toBe(0)
    expect(read.nextReviewAt).toBeNull()
    const struggled = model.applyEncounter(concept.id, 'struggling', clock.nowIso())
    expect(struggled.mastery).toBeCloseTo(0.045)
    expect(struggled.status).toBe('struggling')
    expect(struggled.struggleCount).toBe(1)
  })

  it('pulls reviews in for subject and assignment deadlines', () => {
    const { clock, repos, model, subject, concept } = setup()
    repos.concepts.update(concept.id, {
      mastery: 0.7,
      box: 3,
      nextReviewAt: '2026-10-24T04:00:00.000Z',
    })
    repos.subjects.update(subject.id, { deadline: '2026-11-03' }) // 10 days ahead
    const c = model.applyAnswer(concept.id, true, 2, clock.nowIso())
    expect(c.box).toBe(4)
    expect(c.nextReviewAt).toBe('2026-10-31T04:00:00.000Z') // T−3 d

    repos.assignments.upsert({
      subjectId: subject.id,
      title: 'Problem set 4',
      dueAt: '2026-10-27T12:00:00.000Z',
      source: 'screen',
    })
    expect(model.deadlinesFor(subject.id)).toHaveLength(2)
    const c2 = model.applyAnswer(concept.id, false, 2, clock.nowIso())
    expect(c2.nextReviewAt).toBe('2026-10-25T04:00:00.000Z') // wrong → tomorrow anyway
  })

  it('ramps concept reviews up before a near deadline', () => {
    const { clock, repos, model, subject, concept } = setup()
    const other = repos.concepts.upsert({ subjectId: subject.id, name: 'E1' })
    repos.concepts.update(concept.id, { box: 4, nextReviewAt: '2026-11-10T04:00:00.000Z' })
    repos.concepts.update(other.id, { box: 0, nextReviewAt: null })
    expect(model.rampForDeadlines(clock.now())).toEqual([]) // no deadline yet
    repos.subjects.update(subject.id, { deadline: '2026-10-26T09:00:00.000Z' })
    expect(model.rampForDeadlines(clock.now())).toEqual([concept.id])
    expect(repos.concepts.get(concept.id)?.nextReviewAt).toBe('2026-10-25T04:00:00.000Z')
    expect(model.rampForDeadlines(clock.now())).toEqual([]) // idempotent
  })

  it('rejects unknown concepts and bad timestamps', () => {
    const { model, concept } = setup()
    expect(() => model.applyAnswer('con_missing', true, 2, '2026-10-24T09:00:00Z')).toThrow(
      /not found/,
    )
    expect(() => model.applyEncounter(concept.id, 'understood', 'yesterday')).toThrow(/invalid/)
  })
})
