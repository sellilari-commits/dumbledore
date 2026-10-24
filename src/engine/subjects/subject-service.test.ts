import type { MemoryChanged } from '@shared/state'
import { beforeEach, describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import type { Repos, SubjectService } from '../contracts'
import { createEngineBus } from '../events'
import { encounterInput } from '../store/conformance/fixtures'
import { createSqliteRepos, type SqliteRepos } from '../store/sqlite-repos'
import { createMemoryRepos } from '../testing/memory-repos'
import { createSubjectService } from './subject-service'

function setup(repos: Repos) {
  const bus = createEngineBus()
  const events: MemoryChanged[] = []
  bus.on('memory:changed', (e) => events.push(e))
  return { repos, events, service: createSubjectService({ repos, bus }) }
}

describe.each([
  ['memory', () => createMemoryRepos(new FakeClock())],
  ['sqlite', () => createSqliteRepos(':memory:', new FakeClock())],
])('SubjectService (%s)', (_name, make) => {
  let repos: Repos
  let events: MemoryChanged[]
  let service: SubjectService
  beforeEach(() => {
    ;({ repos, events, service } = setup(make()))
  })

  it('creates subjects with a fitting emoji and announces them', () => {
    const s = service.create({
      name: '  Organic Chemistry ',
      emoji: null,
      goal: ' ',
      deadline: null,
    })
    expect(s).toMatchObject({
      name: 'Organic Chemistry',
      emoji: '🧪',
      goal: null,
      status: 'active',
    })
    expect(
      service.create({ name: 'Basket weaving', emoji: '🧺', goal: 'Weave', deadline: null }),
    ).toMatchObject({ emoji: '🧺', goal: 'Weave' })
    expect(events).toEqual([
      { scope: 'subjects', ids: [s.id] },
      { scope: 'subjects', ids: [expect.any(String)] },
    ])
    expect(() => service.create({ name: '  ', emoji: null, goal: null, deadline: null })).toThrow()
  })

  it('re-activates an existing (e.g. suggested) subject instead of duplicating it', () => {
    const suggested = repos.subjects.create({ name: 'Geography', emoji: '🌍', status: 'suggested' })
    const s = service.create({
      name: 'geography',
      emoji: null,
      goal: 'Pass',
      deadline: '2026-12-01',
    })
    expect(s).toMatchObject({ id: suggested.id, status: 'active', emoji: '🌍', goal: 'Pass' })
    expect(repos.subjects.list()).toHaveLength(1)
  })

  it('updates with trimming, emoji fallback and unique names', () => {
    const a = service.create({ name: 'Chem', emoji: null, goal: null, deadline: null })
    service.create({ name: 'Physics', emoji: null, goal: null, deadline: null })
    expect(
      service.update(a.id, { name: ' Organic Chemistry ', emoji: '', focus: 'focus' }),
    ).toMatchObject({
      name: 'Organic Chemistry',
      emoji: '🧪',
      focus: 'focus',
    })
    expect(() => service.update(a.id, { name: 'physics' })).toThrow(/already exists/)
    expect(() => service.update('sub_missing', { name: 'x' })).toThrow(/not found/)
    expect(events.at(-1)).toEqual({ scope: 'subjects', ids: [a.id] })
  })

  it('accepts, dismisses and merges suggested subjects', () => {
    const into = repos.subjects.create({ name: 'Organic Chemistry' })
    const s1 = repos.subjects.create({ name: 'Orgo', status: 'suggested' })
    const s2 = repos.subjects.create({ name: 'Monsoons', status: 'suggested' })
    const s3 = repos.subjects.create({ name: 'Memes', status: 'suggested' })
    repos.concepts.upsert({ subjectId: s1.id, name: 'SN1' })
    service.actSuggested(s2.id, 'accept', null)
    service.actSuggested(s3.id, 'dismiss', null)
    service.actSuggested(s1.id, 'merge', into.id)
    expect(repos.subjects.get(s2.id)?.status).toBe('active')
    expect(repos.subjects.get(s3.id)?.status).toBe('archived')
    expect(repos.subjects.get(s1.id)).toBeNull()
    expect(repos.concepts.findByName(into.id, 'sn1')).not.toBeNull()
    expect(events.slice(-2)).toEqual([
      { scope: 'subjects', ids: [s1.id, into.id] },
      { scope: 'inbox', ids: [] },
    ])
    expect(() => service.actSuggested(s2.id, 'merge', null)).toThrow()
    expect(() => service.actSuggested(s2.id, 'merge', s2.id)).toThrow(/itself/)
    expect(() => service.actSuggested('sub_missing', 'accept', null)).toThrow(/not found/)
  })

  it('accepts and ignores inbox items', () => {
    const e1 = repos.encounters.add(encounterInput())
    const e2 = repos.encounters.add(encounterInput())
    service.actInbox(e1.id, 'accept', null)
    service.actInbox(e2.id, 'ignore', null)
    expect(
      repos.encounters
        .list({})
        .map((e) => [e.id, e.inboxState])
        .sort(),
    ).toEqual(
      [
        [e1.id, 'accepted'],
        [e2.id, 'ignored'],
      ].sort(),
    )
    expect(events).toEqual([
      { scope: 'inbox', ids: [e1.id] },
      { scope: 'inbox', ids: [e2.id] },
    ])
    expect(() => service.actInbox(e1.id, 'assign', null)).toThrow()
  })

  it('files a loose encounter with its notes, and ignoring one deletes its notes', () => {
    const source = { app: 'Chrome', bundleId: null, url: null, title: 'Tampere' }
    const loose = repos.encounters.add(encounterInput({ topicPath: ['Tampere'] }))
    const other = repos.encounters.add(encounterInput({ topicPath: ['Memes'] }))
    const note = (encounterId: string, text: string) =>
      repos.notes.add({
        subjectId: null,
        conceptId: null,
        encounterId,
        kind: 'fact',
        text,
        source,
      }).note
    const kept = note(loose.id, 'Tampere was founded in 1779')
    const dropped = note(other.id, 'A meme about cats')
    const history = service.create({ name: 'History', emoji: null, goal: null, deadline: null })
    service.actInbox(loose.id, 'assign', history.id)
    expect(repos.notes.get(kept.id)).toMatchObject({ subjectId: history.id, status: 'active' })
    expect(repos.notes.list({ subjectId: null })).toHaveLength(1)
    service.actInbox(other.id, 'ignore', null)
    expect(repos.notes.get(dropped.id)?.status).toBe('deleted')
  })

  it('assigns an encounter to another subject and gives the target its concept', () => {
    const from = repos.subjects.create({ name: 'Biology' })
    const to = repos.subjects.create({ name: 'Chemistry' })
    const c = repos.concepts.upsert({ subjectId: from.id, name: 'Osmosis', summary: 'Water moves' })
    const e = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: c.id }))
    service.actInbox(e.id, 'assign', to.id)
    const moved = repos.encounters.list({ subjectId: to.id })
    expect(moved.map((x) => [x.id, x.inboxState])).toEqual([[e.id, 'accepted']])
    expect(repos.concepts.findByName(to.id, 'osmosis')?.summary).toBe('Water moves')
    expect(events.slice(-2)).toEqual([
      { scope: 'inbox', ids: [e.id] },
      { scope: 'subjects', ids: [from.id, to.id] },
    ])
  })

  it('adds manual assignments', () => {
    const s = repos.subjects.create({ name: 'Chem' })
    const a = service.addAssignment({ title: ' PS 5 ', subjectId: s.id, dueAt: '2026-10-27' })
    expect(a).toMatchObject({ title: 'PS 5', subjectId: s.id, source: 'manual', status: 'open' })
    expect(events).toEqual([{ scope: 'assignments', ids: [a.id] }])
    expect(() => service.addAssignment({ title: ' ', subjectId: null, dueAt: null })).toThrow()
    expect(() =>
      service.addAssignment({ title: 'x', subjectId: 'sub_missing', dueAt: null }),
    ).toThrow()
  })
  it('deletes a subject, clears it as the focus and announces it', () => {
    const s = service.create({ name: 'Chemistry', emoji: null, goal: null, deadline: null })
    repos.settings.update({ focusSubjectId: s.id })
    events.length = 0
    service.remove(s.id)
    expect(repos.subjects.get(s.id)).toBeNull()
    expect(repos.settings.get().focusSubjectId).toBeNull()
    expect(events).toEqual([
      { scope: 'subjects', ids: [s.id] },
      { scope: 'inbox', ids: [] },
    ])
    expect(() => service.remove(s.id)).toThrow(/not found/)
  })
})

describe('SubjectService assign with relink (sqlite)', () => {
  let repos: SqliteRepos
  let service: SubjectService
  beforeEach(() => {
    repos = createSqliteRepos(':memory:', new FakeClock())
    ;({ service } = setup(repos))
  })

  it('moves a concept used only by this encounter, keeping its id and stats', () => {
    const from = repos.subjects.create({ name: 'Biology' })
    const to = repos.subjects.create({ name: 'Chemistry' })
    const c = repos.concepts.upsert({ subjectId: from.id, name: 'Osmosis' })
    repos.concepts.update(c.id, { mastery: 0.6 })
    const e = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: c.id }))
    service.actInbox(e.id, 'assign', to.id)
    expect(repos.concepts.get(c.id)).toMatchObject({ subjectId: to.id, mastery: 0.6 })
    expect(repos.concepts.listBySubject(from.id)).toEqual([])
    expect(repos.encounters.list({})[0]?.conceptId).toBe(c.id)
  })

  it('re-points to a same-named concept in the target, or a copy when the concept is shared', () => {
    const from = repos.subjects.create({ name: 'Biology' })
    const to = repos.subjects.create({ name: 'Chemistry' })
    const shared = repos.concepts.upsert({ subjectId: from.id, name: 'Diffusion' })
    const other = repos.concepts.upsert({ subjectId: from.id, name: 'pH' })
    const twin = repos.concepts.upsert({ subjectId: to.id, name: 'PH' })
    const e1 = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: shared.id }))
    repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: shared.id }))
    const e3 = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: other.id }))

    service.actInbox(e1.id, 'assign', to.id)
    service.actInbox(e3.id, 'accept', to.id)

    const copy = repos.concepts.findByName(to.id, 'Diffusion')
    expect(copy?.id).not.toBe(shared.id)
    expect(repos.concepts.get(shared.id)?.subjectId).toBe(from.id)
    const conceptOf = (id: string) => repos.encounters.list({}).find((x) => x.id === id)?.conceptId
    expect(conceptOf(e1.id)).toBe(copy?.id)
    expect(conceptOf(e3.id)).toBe(twin.id)
  })
})
