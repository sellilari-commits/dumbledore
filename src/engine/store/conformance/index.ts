/**
 * Repository conformance suite: one set of behavioural tests that every `Repos` implementation
 * must pass (the in-memory twin and SQLite). Call `describeReposConformance` from a *.test.ts.
 */
import { afterEach, beforeEach, describe } from 'vitest'
import { FakeClock } from '../../clock'
import { encounterSuite, episodeSuite } from './encounters'
import type { ConformanceTarget, ReposFactory } from './fixtures'
import { learningSuite } from './learning'
import { recordSuite } from './records'
import { searchSuite } from './search'
import { conceptSuite, subjectSuite } from './subjects'

export type { ConformanceTarget, ReposFactory } from './fixtures'

export function describeReposConformance(label: string, factory: ReposFactory): void {
  describe(`Repos conformance — ${label}`, () => {
    let target: ConformanceTarget | null = null
    let cleanup: (() => void) | undefined

    beforeEach(() => {
      const clock = new FakeClock()
      const made = factory(clock)
      target = { repos: made.repos, clock }
      cleanup = made.cleanup
    })
    afterEach(() => {
      cleanup?.()
      target = null
    })

    const current = (): ConformanceTarget => {
      if (!target) throw new Error('conformance target not initialised')
      return target
    }
    subjectSuite(current)
    conceptSuite(current)
    encounterSuite(current)
    episodeSuite(current)
    learningSuite(current)
    recordSuite(current)
    searchSuite(current)
  })
}
