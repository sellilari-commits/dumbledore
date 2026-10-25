import type { Id } from '@shared/domain'
import { beforeEach, describe, expect, it } from 'vitest'
import { fileNotesPrompt } from '../brain/prompts/p17-file-notes'
import type { FileNotesInput, FileNotesOutput } from '../brain-contract'
import { FakeClock } from '../clock'
import { createEngineBus, type EngineBus } from '../events'
import { createSqliteRepos, type SqliteRepos } from '../store/sqlite-repos'
import { createMemoryControl } from './memory-control'
import { createNoteFiling, type NoteFilingService } from './note-filing'

const WIKI = {
  app: 'Google Chrome',
  bundleId: null,
  url: 'https://en.wikipedia.org/wiki/Neural_network_(machine_learning)',
  title: 'Neural network (machine learning) - Wikipedia',
}
const DEEP = 'A deep neural network is a network that has at least two hidden layers.'

async function settle(rounds = 6): Promise<void> {
  for (let i = 0; i < rounds; i++) await new Promise((r) => setImmediate(r))
}

describe('note filing', () => {
  let clock: FakeClock
  let repos: SqliteRepos
  let bus: EngineBus
  let service: NoteFilingService
  let ml: Id
  let chem: Id
  let neural: Id
  let sn1: Id
  let calls: FileNotesInput[]
  /** Files a note mentioning "neural" under Neural networks, "carbocation" under SN1, else loose. */
  const fileNotes = async (input: FileNotesInput): Promise<FileNotesOutput> => {
    calls.push(input)
    return {
      placements: input.notes.map((n) => ({
        noteId: n.id,
        subjectId: null,
        conceptId: /neural/i.test(n.text) ? neural : /carbocation/i.test(n.text) ? sn1 : null,
      })),
    }
  }
  const make = () => createNoteFiling({ repos, brain: { fileNotes }, bus, clock })
  const loose = (text: string, kind: 'fact' | 'highlight' = 'highlight') =>
    repos.notes.add({
      subjectId: null,
      conceptId: null,
      encounterId: null,
      kind,
      text,
      source: WIKI,
    }).note

  beforeEach(() => {
    clock = new FakeClock(new Date(2026, 9, 25, 10, 0, 0).toISOString())
    repos = createSqliteRepos(':memory:', clock)
    bus = createEngineBus()
    calls = []
    ml = repos.subjects.create({ name: 'Machine learning' }).id
    chem = repos.subjects.create({ name: 'Chemistry' }).id
    neural = repos.concepts.upsert({ subjectId: ml, name: 'Neural networks' }).id
    sn1 = repos.concepts.upsert({ subjectId: chem, name: 'SN1' }).id
    service = make()
  })

  it('files a note saved without a topic into the best topic, in one call per batch', async () => {
    service.start()
    const a = loose(DEEP)
    const b = repos.notes.add({
      subjectId: chem,
      conceptId: null,
      encounterId: null,
      kind: 'highlight',
      text: 'Tertiary carbocations are the most stable.',
      source: WIKI,
    }).note
    bus.emit('memory:changed', { scope: 'inbox', ids: [] })
    clock.advance(3_000)
    await settle()
    expect(calls).toHaveLength(1)
    expect(calls[0]?.notes.map((n) => n.id)).toEqual([a.id, b.id])
    expect(calls[0]?.notes[0]?.source).toContain('Neural network (machine learning)')
    expect(calls[0]?.subjects.map((s) => s.name).sort()).toEqual(['Chemistry', 'Machine learning'])
    expect(repos.notes.get(a.id)).toMatchObject({ subjectId: ml, conceptId: neural, pinned: false })
    expect(repos.notes.get(b.id)).toMatchObject({ subjectId: chem, conceptId: sn1 })
    expect(repos.notes.get(a.id)?.text).toBe(DEEP)
    service.stop()
  })

  it('leaves a note loose when nothing fits, and does not ask about it again', async () => {
    const n = loose('The weather in Helsinki was grey on Tuesday.')
    expect(await service.runNow()).toEqual({ offered: 1, filed: 0 })
    expect(repos.notes.get(n.id)).toMatchObject({
      subjectId: null,
      conceptId: null,
      status: 'active',
    })
    expect(await service.runNow()).toEqual({ offered: 0, filed: 0 })
    expect(calls).toHaveLength(1)
  })

  it('refuses a topic of another subject for a note that already has a subject', async () => {
    const n = repos.notes.add({
      subjectId: chem,
      conceptId: null,
      encounterId: null,
      kind: 'highlight',
      text: 'Neural nets learn weights.',
      source: WIKI,
    }).note
    await service.runNow()
    expect(repos.notes.get(n.id)).toMatchObject({ subjectId: chem, conceptId: null })
  })

  it('files the notes that were loose before, once, in the background after startup', async () => {
    const old = [loose(DEEP), loose('Backpropagation trains a neural network.', 'fact')]
    const stray = loose('Unrelated shopping list item.')
    const control = createMemoryControl(repos)
    const byHand = loose('Neural nets were filed to Chemistry by the student.')
    control.fileNote(byHand.id, chem, null)
    service.start()
    clock.advance(19_000)
    await settle()
    expect(calls).toHaveLength(0)
    clock.advance(1_000)
    await settle()
    expect(calls).toHaveLength(1)
    // The hand-filed note is pinned and never offered.
    expect(calls[0]?.notes.map((n) => n.id)).toEqual([...old, stray].map((n) => n.id))
    for (const n of old) expect(repos.notes.get(n.id)?.conceptId).toBe(neural)
    expect(repos.notes.get(stray.id)?.subjectId).toBeNull()
    expect(repos.notes.get(byHand.id)).toMatchObject({ subjectId: chem, conceptId: null })
    service.stop()

    // Next start: nothing new, so no call (idempotent); nothing was deleted.
    const next = make()
    next.start()
    clock.advance(20_000)
    await settle()
    expect(calls).toHaveLength(1)
    expect(repos.notes.list({}).length).toBe(4)
    next.stop()
  })

  it('never moves a note the student moved by hand', async () => {
    const control = createMemoryControl(repos)
    const n = loose(DEEP)
    await service.runNow()
    expect(repos.notes.get(n.id)?.conceptId).toBe(neural)
    // The student moves it to Chemistry (no topic): pinned, and the filer leaves it there.
    expect(control.fileNote(n.id, chem, null).pinned).toBe(true)
    expect(await service.runNow()).toEqual({ offered: 0, filed: 0 })
    expect(repos.notes.get(n.id)).toMatchObject({ subjectId: chem, conceptId: null, pinned: true })
    control.fileNote(n.id, chem, sn1)
    await service.runNow()
    expect(repos.notes.get(n.id)).toMatchObject({ subjectId: chem, conceptId: sn1 })
    expect(calls).toHaveLength(1)
  })

  it('waits for the first subject when there is none', async () => {
    repos.subjects.remove(ml)
    repos.subjects.remove(chem)
    loose(DEEP)
    expect(await service.runNow()).toEqual({ offered: 0, filed: 0 })
    expect(repos.settings.get().notesFiledThrough).toBeNull()
  })
})

describe('P17 file notes prompt', () => {
  const input: FileNotesInput = {
    subjects: [
      {
        id: 'sub_a',
        name: 'Machine learning',
        goal: null,
        concepts: [
          { id: 'con_1', name: 'Neural networks', parentId: null },
          { id: 'con_2', name: 'Deep networks', parentId: 'con_1' },
        ],
      },
    ],
    notes: [
      { id: 'not_1', text: DEEP, source: 'Neural network (machine learning)', subjectId: null },
      { id: 'not_2', text: 'Grey weather', source: 'Weather', subjectId: 'sub_a' },
    ],
  }

  it('lists refs and maps the answer back to ids, dropping unknown refs and repeats', () => {
    const built = fileNotesPrompt.build(input, { onDevice: false, today: '2026-10-25' })
    expect(built.user).toContain('s1 Machine learning')
    expect(built.user).toContain('c2 Deep networks < c1')
    expect(built.user).toContain('n2 [in s1]')
    const out = fileNotesPrompt.finalize(
      {
        placements: [
          { note: 'n1', subject: 's1', concept: 'c2' },
          { note: 'n1', subject: null, concept: null },
          { note: 'n2', subject: null, concept: 'c9' },
          { note: 'n7', subject: 's1', concept: 'c1' },
        ],
      },
      input,
    )
    expect(out.placements).toEqual([
      { noteId: 'not_1', subjectId: 'sub_a', conceptId: 'con_2' },
      { noteId: 'not_2', subjectId: null, conceptId: null },
    ])
  })
})
