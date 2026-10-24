import type { Id } from '@shared/domain'
import type { SessionState } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import type { ConsolidateInput } from '../../brain-contract'
import { FakeClock } from '../../clock'
import { createEngineBus, type EngineBus } from '../../events'
import { createSqliteRepos, type SqliteRepos } from '../../store/sqlite-repos'
import { FakeBrain } from '../../testing/fake-brain'
import { type ConsolidationService, createConsolidation } from './service'

const MIN = 60_000
const SOURCE = { app: 'Chrome', bundleId: null, url: null, title: 'Notes' }
const WORDS =
  'alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike november oscar papa quebec romeo sierra tango uniform victor whiskey xray yankee zulu'.split(
    ' ',
  )

async function settle(rounds = 4): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r))
}

describe('consolidation service', () => {
  let clock: FakeClock
  let repos: SqliteRepos
  let bus: EngineBus
  let brain: FakeBrain
  let service: ConsolidationService
  let subject: Id
  let concept: Id
  const inputs = () =>
    brain.calls.filter((c) => c.method === 'consolidate').map((c) => c.input as ConsolidateInput)
  const addNotes = (n: number, from = 0) => {
    for (let i = from; i < from + n; i++)
      repos.notes.add({
        subjectId: subject,
        conceptId: concept,
        encounterId: null,
        kind: 'fact',
        text: `${WORDS[i % WORDS.length]} ${WORDS[(i * 7 + 3) % WORDS.length]} note ${i}`,
        source: SOURCE,
      })
  }

  beforeEach(() => {
    // 10:00 local: past the nightly hour, so the first day's nightly pass is already "done".
    const start = new Date(2026, 9, 24, 10, 0, 0)
    clock = new FakeClock(start.toISOString())
    repos = createSqliteRepos(':memory:', clock)
    bus = createEngineBus()
    brain = new FakeBrain()
    subject = repos.subjects.create({ name: 'Chemistry' }).id
    concept = repos.concepts.upsert({ subjectId: subject, name: 'SN1' }).id
    service = createConsolidation({ repos, brain, bus, clock, relink: repos.relink })
    service.start()
  })

  it('runs after about 10 new notes, then waits for the next 10', async () => {
    addNotes(9)
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(0)
    addNotes(1, 9)
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(1)
    expect(inputs()[0]?.notes).toHaveLength(10)
    expect(repos.subjects.consolidatedAt(subject)).not.toBeNull()
    expect(repos.concepts.get(concept)?.summary).toBe('alpha delta note 0')
    clock.advance(1000)
    addNotes(3, 20)
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(1)
  })

  it('runs nightly for subjects with any change', async () => {
    addNotes(2)
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(0)
    // 03:00 next day.
    clock.set(new Date(2026, 9, 25, 3, 1, 0).toISOString())
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(1)
  })

  it('runs when a subject is opened, at most once per 10 minutes, only if something changed', async () => {
    bus.emit('subject:viewed', { subjectId: subject })
    await settle()
    expect(inputs()).toHaveLength(0) // nothing to consolidate yet
    addNotes(1)
    bus.emit('subject:viewed', { subjectId: subject })
    await settle()
    expect(inputs()).toHaveLength(1)
    clock.advance(1000)
    addNotes(1, 5)
    bus.emit('subject:viewed', { subjectId: subject })
    await settle()
    expect(inputs()).toHaveLength(1) // debounced
    clock.advance(10 * MIN)
    bus.emit('subject:viewed', { subjectId: subject })
    await settle()
    expect(inputs()).toHaveLength(2)
  })

  it('never runs for the subject of a running study session, and backs off after a failure', async () => {
    const session = { subjectId: subject, phase: 'step' } as SessionState
    bus.emit('session:changed', { session })
    addNotes(12)
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(0)
    bus.emit('session:changed', { session: null })

    let fail = true
    brain = new FakeBrain({
      consolidate: async (input) => {
        if (fail) throw new Error('provider down')
        return new FakeBrain().consolidate(input)
      },
    })
    service.stop()
    service = createConsolidation({ repos, brain, bus, clock, relink: repos.relink })
    service.start()
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(1)
    expect(repos.subjects.consolidatedAt(subject)).toBeNull()
    fail = false
    clock.advance(5 * MIN)
    await settle()
    expect(inputs()).toHaveLength(1) // waits 30 minutes after a failure
    clock.advance(30 * MIN)
    await settle()
    expect(inputs()).toHaveLength(2)
    expect(repos.subjects.consolidatedAt(subject)).not.toBeNull()
  })

  it('sends the tree, notes with their pinned flag, and the edges', async () => {
    const parent = repos.concepts.upsert({ subjectId: subject, name: 'Substitution' }).id
    repos.concepts.update(concept, { parentId: parent })
    const other = repos.concepts.upsert({ subjectId: subject, name: 'Carbocations' }).id
    repos.edges.add({ fromId: other, toId: concept })
    addNotes(1)
    const [n] = repos.notes.list({ subjectId: subject })
    repos.notes.update(n?.id as Id, { pinned: true })
    await service.runNow(subject)
    const input = inputs()[0]
    expect(input?.subject).toEqual({ id: subject, name: 'Chemistry', goal: null })
    expect(input?.concepts.map((c) => [c.name, c.parentId])).toEqual([
      ['SN1', parent],
      ['Substitution', null],
      ['Carbocations', null],
    ])
    expect(input?.notes).toEqual([
      { id: n?.id, conceptId: concept, kind: 'fact', text: n?.text, pinned: true },
    ])
    expect(input?.edges).toEqual([{ fromId: other, toId: concept }])
  })
})
