/** Typed notes: placement on the current topic, a named topic or subject, loose; pinned; undo. */
import { createEngineBus } from '@engine/events'
import { ManualClock } from '@engine/store/seed/manual-clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { describe, expect, it } from 'vitest'
import { notePrefixText, TYPED_SOURCE, TypedNotes } from './typed-notes'

function setup() {
  const clock = new ManualClock('2026-10-25T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const changes: string[] = []
  bus.on('memory:changed', (c) => changes.push(`${c.scope}:${c.ids.join(',')}`))
  const chem = repos.subjects.create({ name: 'Chemistry' })
  const bio = repos.subjects.create({ name: 'Biology' })
  const moles = repos.concepts.upsert({ subjectId: chem.id, name: 'Moles' })
  const cells = repos.concepts.upsert({ subjectId: bio.id, name: 'Cells' })
  repos.concepts.update(moles.id, { lastSeenAt: '2026-10-25T08:00:00.000Z' })
  repos.concepts.update(cells.id, { lastSeenAt: '2026-10-25T07:00:00.000Z' })
  return { repos, bus, changes, chem, bio, moles, cells, notes: new TypedNotes({ repos, bus }) }
}

describe('notePrefixText', () => {
  it('takes the text after "note:" or "n:", any case; nothing else', () => {
    expect(notePrefixText('note: Avogadro is 6.022e23')).toBe('Avogadro is 6.022e23')
    expect(notePrefixText('  N:  short')).toBe('short')
    expect(notePrefixText('note:')).toBeNull()
    expect(notePrefixText('notes are useful')).toBeNull()
    expect(notePrefixText('what is a note?')).toBeNull()
  })
})

describe('TypedNotes', () => {
  it('saves on the current topic (the newest), pinned, as a typed note', () => {
    const h = setup()
    const saved = h.notes.save({
      text: 'A mole is 6.022e23 particles',
      subjectId: null,
      conceptId: null,
    })
    expect(saved.where).toBe('Moles')
    const note = h.repos.notes.get(saved.noteId)
    expect(note).toMatchObject({
      subjectId: h.chem.id,
      conceptId: h.moles.id,
      pinned: true,
      source: TYPED_SOURCE,
    })
    expect(h.changes).toEqual([`concepts:${h.moles.id}`, `subjects:${h.chem.id}`])
  })

  it('follows the locked topic', () => {
    const h = setup()
    h.repos.settings.update({ focusTopicId: h.cells.id })
    expect(
      h.notes.save({ text: 'Cells have membranes', subjectId: null, conceptId: null }).where,
    ).toBe('Cells')
  })

  it('uses a topic the coach named, and a named subject without its own current topic', () => {
    const h = setup()
    const onCells = h.notes.save({ text: 'Mitochondria', subjectId: null, conceptId: h.cells.id })
    expect(h.repos.notes.get(onCells.noteId)?.conceptId).toBe(h.cells.id)
    const onBio = h.notes.save({
      text: 'Biology exam on Friday',
      subjectId: h.bio.id,
      conceptId: null,
    })
    expect(onBio.where).toBe('Biology')
    expect(h.repos.notes.get(onBio.noteId)).toMatchObject({ subjectId: h.bio.id, conceptId: null })
  })

  it('ignores unknown ids and falls back to the current topic', () => {
    const h = setup()
    const saved = h.notes.save({ text: 'Fallback', subjectId: 'sub_x', conceptId: 'con_x' })
    expect(saved.where).toBe('Moles')
  })

  it('becomes a loose note when there are no topics', () => {
    const repos = createMemoryRepos(new ManualClock('2026-10-25T09:00:00.000Z'))
    const notes = new TypedNotes({ repos, bus: createEngineBus() })
    const saved = notes.save({ text: 'Read chapter 3', subjectId: null, conceptId: null })
    expect(saved.where).toBe('Loose notes')
    expect(repos.notes.get(saved.noteId)).toMatchObject({ subjectId: null, conceptId: null })
    expect(notes.notesContext()).toMatch(/no topics yet/)
  })

  it('undo deletes the note; a second undo does nothing', () => {
    const h = setup()
    const saved = h.notes.save({ text: 'Oops', subjectId: null, conceptId: null })
    h.notes.undo(saved.noteId)
    expect(h.repos.notes.get(saved.noteId)?.status).toBe('deleted')
    expect(h.repos.notes.list({ conceptId: h.moles.id })).toEqual([])
    h.notes.undo(saved.noteId)
    expect(() => h.notes.save({ text: '  ', subjectId: null, conceptId: null })).toThrow(
      /needs text/,
    )
  })

  it('lists the current topic first, with ids, for the coach', () => {
    const h = setup()
    const text = h.notes.notesContext()
    expect(text.split('\n')[0]).toBe(
      `Current topic for notes: conceptId=${h.moles.id} subjectId=${h.chem.id} · Moles (Chemistry)`,
    )
    expect(text).toContain(`conceptId=${h.cells.id} subjectId=${h.bio.id} · Cells (Biology)`)
  })
})
