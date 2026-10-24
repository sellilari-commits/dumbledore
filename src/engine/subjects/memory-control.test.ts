import { describe, expect, it } from 'vitest'
import { FakeClock } from '../clock'
import { createMemoryRepos } from '../testing/memory-repos'
import { createMemoryControl, treeOrder } from './memory-control'

const SOURCE = { app: 'Chrome', bundleId: null, url: null, title: 'Tampere' }

function setup() {
  const repos = createMemoryRepos(new FakeClock())
  const control = createMemoryControl(repos)
  const history = repos.subjects.create({ name: 'History' })
  const finland = repos.concepts.upsert({ subjectId: history.id, name: 'Finland' })
  const tampere = repos.concepts.upsert({
    subjectId: history.id,
    name: 'Tampere',
    parentName: 'Finland',
  })
  const note = (
    text: string,
    over: { subjectId?: string | null; conceptId?: string | null } = {},
  ) =>
    repos.notes.add({
      subjectId: history.id,
      conceptId: null,
      encounterId: null,
      kind: 'fact',
      text,
      source: SOURCE,
      ...over,
    }).note
  return { repos, control, history, finland, tampere, note }
}

describe('memory control', () => {
  it('orders the tree parent first, siblings by name, and keeps cycles', () => {
    const c = (id: string, name: string, parentId: string | null) =>
      ({ id, name, parentId }) as Parameters<typeof treeOrder>[0][number]
    const order = treeOrder([
      c('b', 'Beta', 'a'),
      c('z', 'Zeta', null),
      c('a', 'Alpha', null),
      c('x', 'Loop1', 'y'),
      c('y', 'Loop2', 'x'),
    ]).map((x) => x.id)
    expect(order).toEqual(['a', 'b', 'z', 'x', 'y'])
  })

  it('lists the tree with notes per concept and unplaced notes apart', () => {
    const { control, history, finland, tampere, note } = setup()
    const placed = note('Tampere lies on the Tammerkoski rapids', { conceptId: tampere.id })
    const floating = note('Gustav III founded it in 1779')
    const tree = control.tree(history.id)
    expect(tree.concepts.map((n) => n.concept.id)).toEqual([finland.id, tampere.id])
    expect(tree.concepts[1]?.notes.map((n) => n.id)).toEqual([placed.id])
    expect(tree.unplaced.map((n) => n.id)).toEqual([floating.id])
    expect(() => control.tree('sub_missing')).toThrow(/not found/)
  })

  it('pins edited notes, refuses empty text and deleted notes', () => {
    const { control, note } = setup()
    const n = note('Finlayson founded a cotton mill')
    expect(control.updateNote(n.id, '  Finlayson founded a cotton mill in 1820 ')).toMatchObject({
      text: 'Finlayson founded a cotton mill in 1820',
      pinned: true,
    })
    expect(() => control.updateNote(n.id, '   ')).toThrow(/needs text/)
    control.deleteNote(n.id)
    expect(() => control.updateNote(n.id, 'again')).toThrow(/not found/)
  })

  it('files a loose note into a subject, only on a concept of that subject', () => {
    const { repos, control, history, tampere, note } = setup()
    const loose = note('Tammerkoski powered the mills', { subjectId: null })
    expect(control.looseNotes().map((n) => n.id)).toEqual([loose.id])
    const other = repos.subjects.create({ name: 'Physics' })
    expect(() => control.fileNote(loose.id, other.id, tampere.id)).toThrow(/another subject/)
    const filed = control.fileNote(loose.id, history.id, tampere.id)
    expect(filed).toMatchObject({ subjectId: history.id, conceptId: tampere.id })
    expect(control.looseNotes()).toEqual([])
  })

  it('renames a concept unless the name is taken, and edits its summary', () => {
    const { control, finland, tampere } = setup()
    expect(() => control.updateConcept(tampere.id, { name: 'finland' })).toThrow(/already exists/)
    expect(
      control.updateConcept(tampere.id, { name: 'Tampere city', summary: ' A mill town ' }),
    ).toMatchObject({ name: 'Tampere city', summary: 'A mill town', summaryPinned: true })
    expect(control.updateConcept(finland.id, {})).toMatchObject({ name: 'Finland' })
    // A rename alone does not pin the summary: consolidation may still rewrite it.
    expect(control.updateConcept(finland.id, { name: 'Suomi' })).not.toHaveProperty('summaryPinned')
  })

  it('deletes a concept with its notes and an encounter with its notes', () => {
    const { repos, control, history, tampere, note } = setup()
    const n = note('Tampere grew fast', { conceptId: tampere.id })
    expect(control.deleteConcept(tampere.id).id).toBe(tampere.id)
    expect(repos.notes.get(n.id)?.status).toBe('deleted')
    const enc = repos.encounters.add({
      subjectId: history.id,
      conceptId: null,
      episodeId: null,
      seen: 'x',
      bigPicture: 'y',
      topicPath: [],
      understanding: 'unknown',
      evidence: '',
      openQuestions: [],
      keyTerms: [],
      source: SOURCE,
      dwellSeconds: 10,
    })
    expect(control.deleteEncounter(enc.id).id).toBe(enc.id)
    expect(() => control.deleteEncounter(enc.id)).toThrow(/not found/)
  })
})
