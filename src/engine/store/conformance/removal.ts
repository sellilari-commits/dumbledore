/** Conformance: deleting a concept or an encounter (docs/NOTES.md §7 delete table). */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, encounterInput, episode, quiz } from './fixtures'

const SOURCE = { app: 'Chrome', bundleId: 'com.google.Chrome', url: null, title: 'Tampere' }

export function removalSuite(t: () => ConformanceTarget): void {
  describe('removal', () => {
    it('deleting a concept deletes its notes, lifts its children and unlinks the rest', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const top = repos.concepts.upsert({ subjectId: s.id, name: 'Finland' })
      const mid = repos.concepts.upsert({ subjectId: s.id, name: 'Tampere', parentName: 'Finland' })
      const leaf = repos.concepts.upsert({
        subjectId: s.id,
        name: 'Finlayson',
        parentName: 'Tampere',
      })
      const other = repos.concepts.upsert({ subjectId: s.id, name: 'Turku' })
      repos.edges.add({ fromId: mid.id, toId: other.id })
      const enc = repos.encounters.add(encounterInput({ subjectId: s.id, conceptId: mid.id }))
      const gone = repos.notes.add({
        subjectId: s.id,
        conceptId: mid.id,
        encounterId: enc.id,
        kind: 'fact',
        text: 'Tampere grew around the Tammerkoski rapids',
        source: SOURCE,
      }).note
      const kept = repos.notes.add({
        subjectId: s.id,
        conceptId: leaf.id,
        encounterId: null,
        kind: 'fact',
        text: 'Finlayson founded a cotton mill in 1820',
        source: SOURCE,
      }).note
      const q = quiz({ subjectIds: [s.id] })
      q.questions[0] = { ...q.questions[0], conceptId: mid.id } as (typeof q.questions)[number]
      repos.quizzes.save(q)

      repos.concepts.remove(mid.id)

      expect(repos.concepts.get(mid.id)).toBeNull()
      expect(repos.concepts.get(leaf.id)?.parentId).toBe(top.id)
      expect(repos.notes.get(gone.id)?.status).toBe('deleted')
      expect(repos.notes.list({ subjectId: s.id }).map((n) => n.id)).toEqual([kept.id])
      expect(repos.encounters.list({ subjectId: s.id })[0]?.conceptId).toBeNull()
      expect(repos.edges.list(s.id)).toEqual([])
      expect(repos.quizzes.get(q.id)?.questions[0]?.conceptId).toBeNull()
      expect(repos.search.query('Tammerkoski', 10)).toEqual([])
      expect(() => repos.concepts.remove(mid.id)).toThrow(/not found/)
    })

    it('a removed concept can be restored with its id and fields', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const top = repos.concepts.upsert({ subjectId: s.id, name: 'Finland' })
      const mid = repos.concepts.upsert({
        subjectId: s.id,
        name: 'Tampere',
        parentName: 'Finland',
        summary: 'Mill town on the Tammerkoski rapids',
      })
      const before = repos.concepts.update(mid.id, { mastery: 0.4, summaryPinned: true })

      repos.concepts.remove(mid.id)
      expect(repos.concepts.restore(before)).toEqual(before)

      expect(repos.concepts.get(mid.id)).toEqual(before)
      expect(repos.concepts.findByName(s.id, 'tampere')?.id).toBe(mid.id)
      expect(repos.search.query('Tammerkoski', 10).map((h) => h.id)).toContain(mid.id)
      expect(() => repos.concepts.restore(before)).toThrow(/exists/)

      repos.concepts.remove(mid.id)
      repos.concepts.remove(top.id)
      expect(repos.concepts.restore(before).parentId).toBeNull()
    })

    it('deleting an encounter deletes its notes and its screen text unless shared', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'History' })
      const ep = episode({ id: 'epi_shared' })
      const solo = episode({ id: 'epi_solo' })
      repos.episodes.save(ep)
      repos.episodes.save(solo)
      const a = repos.encounters.add(encounterInput({ subjectId: s.id, episodeId: ep.id }))
      const b = repos.encounters.add(encounterInput({ subjectId: s.id, episodeId: ep.id }))
      const c = repos.encounters.add(encounterInput({ subjectId: s.id, episodeId: solo.id }))
      const note = repos.notes.add({
        subjectId: s.id,
        conceptId: null,
        encounterId: a.id,
        kind: 'highlight',
        text: 'King Gustav III founded Tampere in 1779',
        source: SOURCE,
      }).note

      repos.encounters.remove(a.id)
      repos.encounters.remove(c.id)

      expect(repos.encounters.list({ subjectId: s.id }).map((e) => e.id)).toEqual([b.id])
      expect(repos.notes.get(note.id)?.status).toBe('deleted')
      expect(repos.episodes.get(ep.id)).not.toBeNull()
      expect(repos.episodes.get(solo.id)).toBeNull()
      expect(repos.search.query('Gustav', 10)).toEqual([])
      expect(() => repos.encounters.remove(a.id)).toThrow(/not found/)
    })
  })
}
