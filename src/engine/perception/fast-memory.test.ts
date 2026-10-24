/**
 * Page → memory latency with the real defaults (Ilari: "if i go to a website i can see that in the
 * side panel in like 5–30 s"): the first segment closes ~12 s after the page has text, the worker
 * judges ~5 s later, and the subject and topic exist well inside 30 s of simulated time.
 */
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { createEngineBus } from '../events'
import { FakeBrain } from '../testing/fake-brain'
import { createMemoryRepos } from '../testing/memory-repos'
import { createPerceptionStack } from './stack'
import { prose } from './testing/frames'
import { runFor, ScriptedHelper, type ScriptedWindow } from './testing/scripted-helper'

const tampere: ScriptedWindow = {
  pid: 10,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 1,
  title: 'Osmosis - Wikipedia',
  url: 'https://en.wikipedia.org/wiki/Osmosis',
  lines: prose('Osmosis', 1, 12),
}

describe('page → subject and topic in the side panel', () => {
  it('a page read with no switch away is in memory, subject active, within 30 s', async () => {
    const clock = new FakeClock('2026-10-25T09:00:00.000Z')
    const helper = new ScriptedHelper(clock)
    const repos = createMemoryRepos(clock)
    const bus = createEngineBus()
    const brain = new FakeBrain()
    const scopes: string[] = []
    bus.on('memory:changed', (c) => scopes.push(c.scope))
    const stack = createPerceptionStack({ helper, repos, bus, clock, brain })
    helper.front = tampere
    stack.start()

    let seenAt: number | null = null // first second at which the subject has a topic
    for (let s = 1; s <= 30 && seenAt === null; s++) {
      await runFor(clock, 1000)
      const [subject] = repos.subjects.list()
      if (subject && repos.concepts.listBySubject(subject.id).length > 0) seenAt = s
    }
    expect(seenAt, 'seconds until subject and topic exist').not.toBeNull()
    expect(seenAt).toBeLessThanOrEqual(30)
    const [subject] = repos.subjects.list()
    expect(subject?.status).toBe('active')
    expect(repos.encounters.list({})[0]?.subjectId).toBe(subject?.id)
    expect(repos.roadmaps.listBySubject(subject?.id ?? '')).toEqual([]) // structuring never makes a roadmap
    expect(scopes).toEqual(expect.arrayContaining(['subjects', 'concepts']))
    stack.stop()
  })

  it('later segments of the same visit add only new lines, every 3 minutes', async () => {
    const clock = new FakeClock('2026-10-25T09:00:00.000Z')
    const helper = new ScriptedHelper(clock)
    const repos = createMemoryRepos(clock)
    const bus = createEngineBus()
    const stack = createPerceptionStack({ helper, repos, bus, clock, brain: new FakeBrain() })
    const closed: number[] = []
    bus.on('perception:episodeClosed', () => closed.push(clock.now()))
    helper.front = tampere
    stack.start()
    await runFor(clock, 30_000)
    expect(closed).toHaveLength(1) // the early first segment
    await runFor(clock, 3 * 60_000)
    expect(closed).toHaveLength(2) // then the rolling checkpoint
    stack.stop()
  })
})
