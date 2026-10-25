/** ChatSaves: questions and course facts said to Dumbledore land in the studying, and undo cleanly. */
import { createEngineBus } from '@engine/events'
import { ManualClock } from '@engine/store/seed/manual-clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { describe, expect, it } from 'vitest'
import { ASKED_SOURCE, ChatSaves } from './chat-saves'
import { TypedNotes } from './typed-notes'

function setup() {
  const clock = new ManualClock('2026-10-25T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const chem = repos.subjects.create({ name: 'Chemistry' })
  const moles = repos.concepts.upsert({ subjectId: chem.id, name: 'Moles' })
  repos.concepts.update(moles.id, { lastSeenAt: '2026-10-25T08:00:00.000Z' })
  const notes = new TypedNotes({ repos, bus })
  return { repos, chem, moles, saves: new ChatSaves({ repos, bus, notes }) }
}

const question = (over: Record<string, unknown> = {}) => ({
  type: 'save_question' as const,
  text: 'why is it 6.022e23?',
  subjectId: null,
  conceptId: null,
  topic: null,
  stuck: false,
  ...over,
})

describe('ChatSaves', () => {
  it('saves a question on the named topic, marks it a gap when stuck, and undoes both', () => {
    const h = setup()
    const r = h.saves.apply(question({ conceptId: h.moles.id, stuck: true }))
    expect(r?.line).toBe(
      'Saved to Chemistry › Moles: open question “why is it 6.022e23?” · marked as a gap',
    )
    const [note] = h.repos.notes.list({ subjectId: h.chem.id })
    expect(note).toMatchObject({
      kind: 'question',
      conceptId: h.moles.id,
      pinned: true,
      source: ASKED_SOURCE,
    })
    expect(h.repos.concepts.get(h.moles.id)).toMatchObject({
      status: 'struggling',
      struggleCount: 1,
    })

    if (r?.undo?.type !== 'undo_save') throw new Error('no undo')
    expect(h.saves.undo(r.undo.saveId)).toBe(true)
    expect(h.repos.notes.list({ subjectId: h.chem.id })).toEqual([])
    expect(h.repos.concepts.get(h.moles.id)).toMatchObject({ status: 'new', struggleCount: 0 })
    expect(h.saves.undo(r.undo.saveId)).toBe(false)
  })

  it('creates a topic named in the chat, and removes it again on undo', () => {
    const h = setup()
    const r = h.saves.apply(question({ subjectId: h.chem.id, topic: 'Avogadro constant' }))
    const topic = h.repos.concepts.findByName(h.chem.id, 'Avogadro constant')
    expect(topic).not.toBeNull()
    expect(r?.line).toMatch(/^Saved to Chemistry › Avogadro constant: open question/)
    if (r?.undo?.type !== 'undo_save') throw new Error('no undo')
    h.saves.undo(r.undo.saveId)
    expect(h.repos.concepts.findByName(h.chem.id, 'Avogadro constant')).toBeNull()
  })

  it('falls back to the current topic, and asks for a subject when there is none', () => {
    const h = setup()
    expect(h.saves.apply(question())?.line).toMatch(/^Saved to Chemistry › Moles:/)
    const empty = createMemoryRepos(new ManualClock('2026-10-25T09:00:00.000Z'))
    const bus = createEngineBus()
    const none = new ChatSaves({ repos: empty, bus, notes: new TypedNotes({ repos: empty, bus }) })
    expect(none.apply(question())).toEqual({
      line: 'Not saved: which subject is this about?',
      undo: null,
      more: [],
    })
  })

  it('saves course facts on the subject with an Undo, and offers to re-plan a running roadmap', () => {
    const h = setup()
    const r = h.saves.apply({
      type: 'update_subject',
      subjectId: h.chem.id,
      goal: 'Pass the midterm',
      deadline: '2026-12-12',
      scope: null,
    })
    expect(r?.line).toBe('Saved to Chemistry: goal “Pass the midterm”, deadline 12 Dec 2026')
    expect(h.repos.subjects.get(h.chem.id)).toMatchObject({
      goal: 'Pass the midterm',
      deadline: '2026-12-12',
    })
    expect(r?.more).toEqual([])
    if (r?.undo?.type !== 'undo_save') throw new Error('no undo')
    h.saves.undo(r.undo.saveId)
    expect(h.repos.subjects.get(h.chem.id)).toMatchObject({ goal: null, deadline: null })
  })

  it('says nothing when a course fact changes nothing', () => {
    const h = setup()
    h.repos.subjects.update(h.chem.id, { goal: 'Pass the midterm' })
    expect(
      h.saves.apply({
        type: 'update_subject',
        subjectId: h.chem.id,
        goal: 'Pass the midterm',
        deadline: null,
        scope: null,
      }),
    ).toEqual({ line: '', undo: null, more: [] })
  })

  it('saves a note the student asked to keep, undone by its undo_note', () => {
    const h = setup()
    const r = h.saves.apply({
      type: 'add_note',
      text: 'A mole is 6.022e23',
      subjectId: null,
      conceptId: null,
    })
    expect(r?.line).toBe('Saved to Moles: “A mole is 6.022e23”')
    expect(r?.undo?.type).toBe('undo_note')
    expect(h.saves.apply({ type: 'set_focus', subjectId: null })).toBeNull()
  })
})
