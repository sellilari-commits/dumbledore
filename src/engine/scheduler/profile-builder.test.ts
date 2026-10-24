import type { ProfileInput } from '@engine/brain-contract'
import { FakeBrain } from '@engine/testing/fake-brain'
import { describe, expect, it } from 'vitest'
import { HOUR_MS } from './local-time'
import { createProfileBuilder, profileInput } from './profile-builder'
import { studentWorld } from './scheduler-fixtures'

function setup(brain = new FakeBrain()) {
  const w = studentWorld({ brain })
  const builder = createProfileBuilder({
    repos: w.repos,
    brain,
    bus: w.bus,
    clock: w.clock,
    localTime: w.localTime,
    log: () => {},
  })
  return { ...w, builder, brain }
}

describe('profile builder', () => {
  it('has nothing to summarise without About you or subjects', async () => {
    const s = setup()
    expect(profileInput(s.repos)).toBeNull()
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(false)
    expect(s.brain.calls).toEqual([])
  })

  it('summarises subjects, struggles and habits once a day', async () => {
    const brain = new FakeBrain({
      buildProfile: async () => ({
        summary: 'Second-year chemistry student; struggles with carbocations.',
        level: 'university, year 2',
        habitsToCoach: ['Give context', 'Ask to be quizzed'],
      }),
    })
    const s = setup(brain)
    s.repos.profile.update({
      aboutMe: 'Chemistry student at Aalto',
      habits: {
        promptsSeen: 12,
        withContext: 3,
        withStructure: 2,
        askedToBeQuizzed: 0,
        askedForExamples: 5,
      },
    })
    const chem = s.repos.subjects.create({
      name: 'Organic Chemistry',
      deadline: '2026-12-12',
      goal: 'Pass the midterm',
    })
    const c = s.repos.concepts.upsert({ subjectId: chem.id, name: 'Carbocations' })
    s.repos.concepts.update(c.id, { status: 'struggling', struggleCount: 3, mastery: 0.25 })

    expect(await s.builder.maybeBuild(s.clock.now())).toBe(true)
    const input = brain.calls[0]?.input as ProfileInput
    expect(input.aboutMe).toBe('Chemistry student at Aalto')
    expect(input.subjects).toBe(
      '- Organic Chemistry, deadline 2026-12-12, goal: Pass the midterm: 1 concepts, mastery 25%, 1 struggling',
    )
    expect(input.struggles).toBe('- Carbocations (struggled 3×, mastery 25%)')
    expect(input.habits).toContain('12 prompts seen; 3 gave context')
    expect(s.repos.profile.get()).toMatchObject({
      summary: 'Second-year chemistry student; struggles with carbocations.',
      level: 'university, year 2',
    })
    expect(s.builder.habitsToCoach()).toEqual(['Give context', 'Ask to be quizzed'])
    expect(s.events).toContainEqual({
      name: 'memory:changed',
      payload: { scope: 'profile', ids: ['profile'] },
    })

    s.clock.advance(5 * HOUR_MS)
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(false)
    s.clock.set('2026-10-25T09:00:00.000Z')
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(true)
    expect(brain.calls).toHaveLength(2)
  })

  it('keeps the previous profile when the profiler fails, and retries later', async () => {
    let fail = true
    const brain = new FakeBrain({
      buildProfile: async (input) => {
        if (fail) throw new Error('rate limited')
        return { summary: `New: ${input.aboutMe}`, level: null, habitsToCoach: [] }
      },
    })
    const s = setup(brain)
    s.repos.profile.update({
      aboutMe: 'Physics student',
      summary: 'Old summary',
      level: 'high school',
    })
    s.clock.advance(24 * HOUR_MS) // yesterday's summary
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(false)
    expect(s.repos.profile.get()).toMatchObject({ summary: 'Old summary', level: 'high school' })
    fail = false
    s.clock.advance(HOUR_MS)
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(false) // waits 2 h after a failure
    s.clock.advance(HOUR_MS)
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(true)
    expect(s.repos.profile.get()).toMatchObject({
      summary: 'New: Physics student',
      level: 'high school',
    })
  })

  it('treats a summary written earlier today as today’s build', async () => {
    const s = setup()
    s.repos.profile.update({ aboutMe: 'Student', summary: 'Built this morning' })
    expect(await s.builder.maybeBuild(s.clock.now())).toBe(false)
    expect(s.brain.calls).toEqual([])
  })
})
