/** The coach's context: today, and subjects and topics with the ids its tools take. */
import { createQueryService } from '@engine/queries/query-service'
import { ManualClock } from '@engine/store/seed/manual-clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { describe, expect, it } from 'vitest'
import { coachContextText } from './context'

describe('coachContextText', () => {
  it('names today and lists subjects and their topics with ids, gaps first', () => {
    const clock = new ManualClock('2026-10-25T09:00:00.000Z')
    const repos = createMemoryRepos(clock)
    const chem = repos.subjects.create({ name: 'Chemistry' })
    repos.subjects.update(chem.id, { goal: 'Pass the midterm' })
    const moles = repos.concepts.upsert({ subjectId: chem.id, name: 'Moles' })
    const sn1 = repos.concepts.upsert({ subjectId: chem.id, name: 'SN1' })
    repos.concepts.update(sn1.id, { status: 'struggling' })
    const text = coachContextText({
      repos,
      queries: createQueryService({ repos, clock, greetingName: 'Olle' }),
      study: { current: () => null },
      perception: { now: () => null, aiChat: () => null },
      nowIso: () => clock.nowIso(),
    })
    expect(text).toMatch(/^Today: 2026-10-25 \(Sunday\)/)
    expect(text).toContain(`Chemistry [${chem.id}]`)
    expect(text).toContain('goal: Pass the midterm')
    expect(text).toContain(`Topics: SN1 [${sn1.id}] (gap), Moles [${moles.id}]`)
  })
})
