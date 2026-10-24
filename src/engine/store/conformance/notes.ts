/** Conformance: NoteRepo (dedupe, places, soft delete, merge, search) and EdgeRepo (no cycles). */
import { describe, expect, it } from 'vitest'
import type { NewNoteInput } from '../../contracts'
import { type ConformanceTarget, encounterInput } from './fixtures'

const SOURCE = { app: 'Chrome', bundleId: 'com.google.Chrome', url: null, title: 'Tampere' }

const noteInput = (over: Partial<NewNoteInput> = {}): NewNoteInput => ({
  subjectId: null,
  conceptId: null,
  encounterId: null,
  kind: 'fact',
  text: 'Tampere was founded in 1779 by King Gustav III',
  source: SOURCE,
  ...over,
})

export function noteSuite(t: () => ConformanceTarget): void {
  describe('notes', () => {
    it('adds trimmed notes with clock timestamps and lists them oldest first', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'History' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere' })
      const { note, created } = repos.notes.add(
        noteInput({
          subjectId: s.id,
          conceptId: c.id,
          text: '  Tampere   lies on the Tammerkoski rapids ',
        }),
      )
      expect(created).toBe(true)
      expect(note).toEqual({
        id: expect.stringMatching(/^not_/),
        subjectId: s.id,
        conceptId: c.id,
        encounterId: null,
        kind: 'fact',
        text: 'Tampere lies on the Tammerkoski rapids',
        keywords: [],
        source: SOURCE,
        status: 'active',
        mergedInto: null,
        pinned: false,
        createdAt: clock.nowIso(),
        updatedAt: clock.nowIso(),
      })
      const second = repos.notes.add(noteInput({ subjectId: s.id, conceptId: c.id })).note
      expect(repos.notes.get(note.id)).toEqual(note)
      expect(repos.notes.get('not_missing')).toBeNull()
      expect(repos.notes.list({ conceptId: c.id }).map((n) => n.id)).toEqual([note.id, second.id])
      expect(repos.notes.list({ subjectId: s.id }).map((n) => n.id)).toEqual([note.id, second.id])
    })

    it('cuts long text at 200 characters and refuses empty text', () => {
      const { repos } = t()
      const long = repos.notes.add(noteInput({ kind: 'highlight', text: 'x '.repeat(300) })).note
      expect(long.text.length).toBeLessThanOrEqual(200)
      expect(long.text.endsWith('…')).toBe(true)
      expect(() => repos.notes.add(noteInput({ text: '   ' }))).toThrow(/needs text/)
    })

    it('dedupes within the same place by key or word overlap, touching the old note', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'History' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere' })
      const first = repos.notes.add(noteInput({ subjectId: s.id, conceptId: c.id })).note
      clock.advance(60_000)
      const same = repos.notes.add(
        noteInput({
          subjectId: s.id,
          conceptId: c.id,
          text: 'tampere was founded in 1779, by King Gustav III.',
          keywords: [' Tampere ', 'Gustav III', 'tampere'],
        }),
      )
      expect(same.created).toBe(false)
      expect(same.note.id).toBe(first.id)
      expect(same.note.keywords).toEqual(['Tampere', 'Gustav III'])
      expect(same.note.updatedAt).toBe(clock.nowIso())
      const close = repos.notes.add(
        noteInput({
          subjectId: s.id,
          conceptId: c.id,
          text: 'Tampere was founded in 1779 by the King Gustav III',
        }),
      )
      expect(close.created).toBe(false)
      // A different place keeps its own copy: the loose notes, and the subject without concept.
      expect(repos.notes.add(noteInput()).created).toBe(true)
      expect(repos.notes.add(noteInput()).created).toBe(false)
      expect(repos.notes.add(noteInput({ subjectId: s.id })).created).toBe(true)
      expect(
        repos.notes.add(
          noteInput({
            subjectId: s.id,
            conceptId: c.id,
            text: 'Finlayson built a cotton mill in 1820',
          }),
        ).created,
      ).toBe(true)
      expect(repos.notes.list({ conceptId: c.id })).toHaveLength(2)
    })

    it('lists loose notes, by encounter and by status', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const enc = repos.encounters.add(encounterInput())
      const loose = repos.notes.add(noteInput({ encounterId: enc.id })).note
      const filed = repos.notes.add(
        noteInput({ subjectId: s.id, text: 'Finlayson founded a mill' }),
      ).note
      expect(repos.notes.list({ subjectId: null }).map((n) => n.id)).toEqual([loose.id])
      expect(repos.notes.list({ encounterId: enc.id }).map((n) => n.id)).toEqual([loose.id])
      repos.notes.remove(filed.id)
      expect(repos.notes.list({}).map((n) => n.id)).toEqual([loose.id])
      expect(repos.notes.list({ status: 'deleted' }).map((n) => n.id)).toEqual([filed.id])
      expect(repos.notes.list({ status: null })).toHaveLength(2)
      expect(repos.notes.list({ status: null, limit: 1 })).toHaveLength(1)
    })

    it('updates text, place and pin; a deleted note may come back as new text', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'History' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere' })
      const note = repos.notes.add(noteInput()).note
      clock.advance(1000)
      const filed = repos.notes.update(note.id, {
        subjectId: s.id,
        conceptId: c.id,
        text: ' Tampere got city rights on 1 October 1779 ',
        pinned: true,
      })
      expect(filed).toMatchObject({
        subjectId: s.id,
        conceptId: c.id,
        text: 'Tampere got city rights on 1 October 1779',
        pinned: true,
        updatedAt: clock.nowIso(),
      })
      expect(filed.createdAt).toBe(note.createdAt)
      expect(() => repos.notes.update(note.id, { text: ' ' })).toThrow(/needs text/)
      expect(() => repos.notes.update('not_missing', { pinned: true })).toThrow(/not found/)
      repos.notes.remove(note.id)
      expect(repos.notes.get(note.id)?.status).toBe('deleted')
      const again = repos.notes.add(
        noteInput({ subjectId: s.id, conceptId: c.id, text: filed.text }),
      )
      expect(again.created).toBe(true)
    })

    it('merges one note into another, optionally rewording the survivor', () => {
      const { repos } = t()
      const a = repos.notes.add(noteInput()).note
      const b = repos.notes.add(noteInput({ text: 'Gustav III founded Tampere' })).note
      const survivor = repos.notes.merge(b.id, a.id, 'King Gustav III founded Tampere in 1779')
      expect(survivor.text).toBe('King Gustav III founded Tampere in 1779')
      expect(repos.notes.get(b.id)).toMatchObject({ status: 'merged', mergedInto: a.id })
      expect(repos.notes.merge(a.id, a.id).id).toBe(a.id)
      expect(() => repos.notes.merge('not_missing', a.id)).toThrow(/not found/)
    })

    it('finds active notes in search, as their concept or their encounter', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere' })
      repos.notes.add(
        noteInput({ subjectId: s.id, conceptId: c.id, text: 'Finlayson cotton mill 1820' }),
      )
      const enc = repos.encounters.add(encounterInput({ seen: 'Industrial towns' }))
      const loose = repos.notes.add(
        noteInput({ encounterId: enc.id, text: 'Finlayson came from Scotland' }),
      ).note
      repos.notes.add(noteInput({ text: 'Finlayson without a source' }))
      const hits = repos.search.query('finlayson', 10)
      expect(hits.map((h) => [h.kind, h.id, h.snippet])).toEqual([
        ['concept', c.id, 'Finlayson cotton mill 1820'],
        ['encounter', enc.id, 'Finlayson came from Scotland'],
      ])
      expect(hits[1]?.route).toBe('/inbox')
      repos.notes.remove(loose.id)
      expect(repos.search.query('scotland', 10)).toEqual([])
      repos.notes.add(
        noteInput({ subjectId: s.id, conceptId: c.id, text: 'Tampere lies on rapids' }),
      )
      // The concept matches by name and by a note: it shows once.
      expect(repos.search.query('tampere', 10).filter((h) => h.id === c.id)).toHaveLength(1)
    })

    it('stores a pinned concept summary; the flag is present only when true', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere' })
      expect(repos.concepts.get(c.id)).not.toHaveProperty('summaryPinned')
      repos.concepts.update(c.id, { summary: 'My own words', summaryPinned: true })
      expect(repos.concepts.get(c.id)).toMatchObject({
        summary: 'My own words',
        summaryPinned: true,
      })
      expect(repos.concepts.listBySubject(s.id)[0]?.summaryPinned).toBe(true)
      repos.concepts.update(c.id, { summaryPinned: false })
      expect(repos.concepts.get(c.id)).not.toHaveProperty('summaryPinned')
    })

    it('subject merge and concept folding carry notes; subject delete removes them', () => {
      const { repos } = t()
      const from = repos.subjects.create({ name: 'Finnish history' })
      const into = repos.subjects.create({ name: 'History' })
      const dup = repos.concepts.upsert({ subjectId: from.id, name: 'Tampere' })
      const twin = repos.concepts.upsert({ subjectId: into.id, name: 'tampere' })
      const other = repos.concepts.upsert({ subjectId: from.id, name: 'Turku' })
      const n1 = repos.notes.add(noteInput({ subjectId: from.id, conceptId: dup.id })).note
      const n2 = repos.notes.add(
        noteInput({ subjectId: from.id, conceptId: other.id, text: 'Turku was the capital' }),
      ).note
      const n3 = repos.notes.add(noteInput({ subjectId: from.id, text: 'Loose in subject' })).note
      repos.subjects.merge(from.id, into.id)
      expect(repos.notes.get(n1.id)).toMatchObject({ subjectId: into.id, conceptId: twin.id })
      expect(repos.notes.get(n2.id)).toMatchObject({ subjectId: into.id, conceptId: other.id })
      expect(repos.notes.get(n3.id)?.subjectId).toBe(into.id)
      repos.subjects.remove(into.id)
      expect(repos.notes.list({ status: null })).toEqual([])
      expect(repos.search.query('turku', 10)).toEqual([])
    })
  })
}

export function edgeSuite(t: () => ConformanceTarget): void {
  describe('concept edges', () => {
    const seed = (target: ConformanceTarget) => {
      const s = target.repos.subjects.create({ name: 'Chemistry' })
      const [a, b, c] = ['Atoms', 'Bonds', 'Carbocations'].map(
        (name) => target.repos.concepts.upsert({ subjectId: s.id, name }).id,
      ) as [string, string, string]
      return { s, a, b, c }
    }

    it('adds edges with defaults and refuses self-loops, duplicates, cycles and other subjects', () => {
      const target = t()
      const { repos, clock } = target
      const { s, a, b, c } = seed(target)
      expect(repos.edges.add({ fromId: a, toId: b, why: ' needs atoms ' })).toEqual({
        fromId: a,
        toId: b,
        why: 'needs atoms',
        source: 'llm',
        createdAt: clock.nowIso(),
      })
      expect(repos.edges.add({ fromId: b, toId: c, source: 'user' })?.source).toBe('user')
      expect(repos.edges.add({ fromId: a, toId: a })).toBeNull()
      expect(repos.edges.add({ fromId: a, toId: b })).toBeNull()
      expect(repos.edges.add({ fromId: c, toId: a })).toBeNull()
      const bio = repos.subjects.create({ name: 'Biology' })
      const cell = repos.concepts.upsert({ subjectId: bio.id, name: 'Cells' })
      expect(repos.edges.add({ fromId: a, toId: cell.id })).toBeNull()
      expect(() => repos.edges.add({ fromId: 'con_missing', toId: a })).toThrow(/not found/)
      expect(repos.edges.list(s.id).map((e) => [e.fromId, e.toId])).toEqual([
        [a, b],
        [b, c],
      ])
      expect(repos.edges.list(bio.id)).toEqual([])
      repos.edges.remove(a, b)
      expect(repos.edges.list(s.id).map((e) => [e.fromId, e.toId])).toEqual([[b, c]])
    })

    it('folding a concept re-points its edges and drops what would loop', () => {
      const target = t()
      const { repos } = target
      const { s, a, b, c } = seed(target)
      const other = repos.subjects.create({ name: 'Organic' })
      const dup = repos.concepts.upsert({ subjectId: other.id, name: 'Bonds' }).id
      const extra = repos.concepts.upsert({ subjectId: other.id, name: 'Alkenes' }).id
      repos.edges.add({ fromId: a, toId: b })
      repos.edges.add({ fromId: dup, toId: extra })
      repos.subjects.merge(other.id, s.id)
      expect(repos.edges.list(s.id).map((e) => [e.fromId, e.toId])).toEqual([
        [a, b],
        [b, extra],
      ])
      expect(repos.concepts.get(c)).not.toBeNull()
      repos.subjects.remove(s.id)
      expect(repos.edges.list(s.id)).toEqual([])
    })
  })
}
