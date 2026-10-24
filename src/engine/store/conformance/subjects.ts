/** Conformance: SubjectRepo and ConceptRepo (including merge). */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, encounterInput, episode, quiz, roadmap } from './fixtures'

export function subjectSuite(t: () => ConformanceTarget): void {
  describe('subjects', () => {
    it('stores, replaces and clears study preferences; a removed subject takes them along', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chemistry' })
      expect(repos.subjects.studyPreferences(s.id)).toBeNull()
      const prefs = {
        instruction: 'SN1, not SN2',
        focus: ['con_1'],
        skip: ['con_2'],
        focusNames: [],
        skipNames: [],
        updatedAt: '2026-10-25T09:00:00.000Z',
      }
      repos.subjects.setStudyPreferences(s.id, prefs)
      expect(repos.subjects.studyPreferences(s.id)).toEqual(prefs)
      repos.subjects.setStudyPreferences(s.id, { ...prefs, focus: [] })
      expect(repos.subjects.studyPreferences(s.id)?.focus).toEqual([])
      repos.subjects.setStudyPreferences(s.id, null)
      expect(repos.subjects.studyPreferences(s.id)).toBeNull()
      repos.subjects.setStudyPreferences(s.id, prefs)
      repos.subjects.remove(s.id)
      expect(repos.subjects.studyPreferences(s.id)).toBeNull()
      expect(() => repos.subjects.setStudyPreferences('sub_missing', prefs)).toThrow(/not found/)
    })

    it('creates with defaults, trimmed name and clock timestamps', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: '  Organic Chemistry ' })
      expect(s).toEqual({
        id: expect.stringMatching(/^sub_/),
        name: 'Organic Chemistry',
        emoji: '📘',
        color: 'default',
        description: '',
        goal: null,
        deadline: null,
        status: 'active',
        focus: 'normal',
        createdAt: clock.nowIso(),
        updatedAt: clock.nowIso(),
      })
      expect(repos.subjects.get(s.id)).toEqual(s)
      expect(repos.subjects.get('sub_missing')).toBeNull()
    })

    it('stores every optional field', () => {
      const { repos } = t()
      const s = repos.subjects.create({
        name: 'Geography',
        emoji: '🌍',
        color: 'green',
        description: 'Maps',
        goal: 'Pass',
        deadline: '2026-12-12',
        status: 'suggested',
      })
      expect(repos.subjects.get(s.id)).toMatchObject({
        emoji: '🌍',
        color: 'green',
        description: 'Maps',
        goal: 'Pass',
        deadline: '2026-12-12',
        status: 'suggested',
      })
    })

    it('lists by creation time (ties in insertion order) and filters by status', () => {
      const { repos, clock } = t()
      const b = repos.subjects.create({ name: 'B' })
      const c = repos.subjects.create({ name: 'C', status: 'suggested' })
      clock.advance(1000)
      const a = repos.subjects.create({ name: 'A', status: 'archived' })
      expect(repos.subjects.list().map((s) => s.id)).toEqual([b.id, c.id, a.id])
      expect(repos.subjects.list({ status: ['suggested'] }).map((s) => s.id)).toEqual([c.id])
      expect(repos.subjects.list({ status: ['archived', 'active'] }).map((s) => s.id)).toEqual([
        b.id,
        a.id,
      ])
    })

    it('finds by name ignoring case and whitespace', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Linear  Algebra' })
      expect(repos.subjects.findByName('  linear algebra ')?.id).toBe(s.id)
      expect(repos.subjects.findByName('linear')).toBeNull()
    })

    it('updates fields, bumps updatedAt and keeps createdAt', () => {
      const { repos, clock } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      clock.advance(5000)
      const u = repos.subjects.update(s.id, { name: 'Chemistry', focus: 'focus', goal: null })
      expect(u).toMatchObject({ name: 'Chemistry', focus: 'focus', createdAt: s.createdAt })
      expect(u.updatedAt).toBe(clock.nowIso())
      expect(repos.subjects.get(s.id)).toEqual(u)
      expect(repos.subjects.findByName('chemistry')?.id).toBe(s.id)
      expect(() => repos.subjects.update('sub_missing', { name: 'x' })).toThrow(/not found/)
    })

    it('returns copies that do not alias stored state', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      s.name = 'Mutated'
      expect(repos.subjects.get(s.id)?.name).toBe('Chem')
    })

    it('merges concepts, encounters, roadmaps, quizzes and assignments into the target', () => {
      const { repos } = t()
      const from = repos.subjects.create({ name: 'Orgo', status: 'suggested' })
      const into = repos.subjects.create({ name: 'Organic Chemistry' })
      const twin = repos.concepts.upsert({ subjectId: into.id, name: 'SN1' })
      const dup = repos.concepts.upsert({ subjectId: from.id, name: 'sn1 ' })
      const child = repos.concepts.upsert({ subjectId: from.id, name: 'SN1 rate law' })
      repos.concepts.update(child.id, { parentId: dup.id })
      const moved = repos.concepts.upsert({ subjectId: from.id, name: 'Carbocations' })
      const enc = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: dup.id }))
      repos.roadmaps.save(roadmap(from.id))
      repos.quizzes.save(quiz({ subjectIds: [from.id, into.id] }))
      const asg = repos.assignments.upsert({
        subjectId: from.id,
        title: 'PS 5',
        dueAt: null,
        source: 'x',
      })

      repos.subjects.merge(from.id, into.id)

      expect(repos.subjects.get(from.id)).toBeNull()
      expect(repos.concepts.get(dup.id)).toBeNull()
      expect(repos.concepts.listBySubject(into.id).map((c) => c.id)).toEqual([
        twin.id,
        child.id,
        moved.id,
      ])
      expect(repos.concepts.get(child.id)?.parentId).toBe(twin.id)
      expect(repos.encounters.list({}).map((e) => [e.id, e.subjectId, e.conceptId])).toEqual([
        [enc.id, into.id, twin.id],
      ])
      expect(repos.roadmaps.get('rdm_1')?.subjectId).toBe(into.id)
      expect(repos.quizzes.get('quz_1')?.subjectIds).toEqual([into.id])
      expect(repos.assignments.list({}).find((a) => a.id === asg.id)?.subjectId).toBe(into.id)
      expect(() => repos.subjects.merge(from.id, into.id)).toThrow(/not found/)
    })

    it('removes a subject and everything remembered about it', () => {
      const { repos } = t()
      const gone = repos.subjects.create({ name: 'Stereochemistry' })
      const kept = repos.subjects.create({ name: 'Biology' })
      const concept = repos.concepts.upsert({ subjectId: gone.id, name: 'Enantiomers' })
      const keptConcept = repos.concepts.upsert({ subjectId: kept.id, name: 'Mitosis' })
      repos.episodes.save(episode({ id: 'epi_gone' }))
      repos.episodes.save(episode({ id: 'epi_kept' }))
      repos.encounters.add(
        encounterInput({ subjectId: gone.id, conceptId: concept.id, episodeId: 'epi_gone' }),
      )
      const keptEnc = repos.encounters.add(
        encounterInput({ subjectId: kept.id, conceptId: keptConcept.id, episodeId: 'epi_kept' }),
      )
      repos.roadmaps.save(roadmap(gone.id))
      repos.quizzes.save(quiz({ id: 'quz_only', subjectIds: [gone.id] }))
      repos.quizzes.save(quiz({ id: 'quz_both', subjectIds: [gone.id, kept.id] }))
      repos.assignments.upsert({ subjectId: gone.id, title: 'PS 5', dueAt: null, source: 'x' })

      repos.subjects.remove(gone.id)

      expect(repos.subjects.get(gone.id)).toBeNull()
      expect(repos.subjects.list().map((s) => s.id)).toEqual([kept.id])
      expect(repos.concepts.get(concept.id)).toBeNull()
      expect(repos.concepts.get(keptConcept.id)).not.toBeNull()
      expect(repos.encounters.list({}).map((e) => e.id)).toEqual([keptEnc.id])
      expect(repos.episodes.get('epi_gone')).toBeNull()
      expect(repos.episodes.get('epi_kept')).not.toBeNull()
      expect(repos.roadmaps.get('rdm_1')).toBeNull()
      expect(repos.quizzes.get('quz_only')).toBeNull()
      expect(repos.quizzes.get('quz_both')?.subjectIds).toEqual([kept.id])
      expect(repos.assignments.list({})).toEqual([])
      expect(repos.search.query('Stereochem', 10)).toEqual([])
      expect(repos.search.query('Enantiomers', 10)).toEqual([])
      expect(() => repos.subjects.remove(gone.id)).toThrow(/not found/)
    })
  })
}

export function conceptSuite(t: () => ConformanceTarget): void {
  describe('concepts', () => {
    it('upserts with defaults and dedupes by normalized name within the subject', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const other = repos.subjects.create({ name: 'Bio' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: ' SN1 ' })
      expect(c).toEqual({
        id: expect.stringMatching(/^con_/),
        subjectId: s.id,
        parentId: null,
        name: 'SN1',
        summary: '',
        mastery: 0,
        box: 0,
        nextReviewAt: null,
        status: 'new',
        struggleCount: 0,
        lastSeenAt: null,
      })
      expect(repos.concepts.upsert({ subjectId: s.id, name: 'sn1' }).id).toBe(c.id)
      expect(repos.concepts.upsert({ subjectId: other.id, name: 'SN1' }).id).not.toBe(c.id)
      expect(repos.concepts.listBySubject(s.id)).toHaveLength(1)
    })

    it('fills an empty summary on upsert but never overwrites one', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
      expect(
        repos.concepts.upsert({ subjectId: s.id, name: 'SN1', summary: 'First' }).summary,
      ).toBe('First')
      expect(
        repos.concepts.upsert({ subjectId: s.id, name: 'SN1', summary: 'Second' }).summary,
      ).toBe('First')
      expect(repos.concepts.get(c.id)?.summary).toBe('First')
    })

    it('creates or reuses the parent by name', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const sn1 = repos.concepts.upsert({
        subjectId: s.id,
        name: 'SN1',
        parentName: 'Substitution',
      })
      const sn2 = repos.concepts.upsert({
        subjectId: s.id,
        name: 'SN2',
        parentName: 'substitution',
      })
      const parent = repos.concepts.findByName(s.id, 'SUBSTITUTION')
      expect(parent?.parentId).toBeNull()
      expect(sn1.parentId).toBe(parent?.id)
      expect(sn2.parentId).toBe(parent?.id)
      expect(repos.concepts.listBySubject(s.id).map((c) => c.name)).toEqual([
        'Substitution',
        'SN1',
        'SN2',
      ])
    })

    it('finds by name only within the subject', () => {
      const { repos } = t()
      const a = repos.subjects.create({ name: 'A' })
      const b = repos.subjects.create({ name: 'B' })
      repos.concepts.upsert({ subjectId: a.id, name: 'Vectors' })
      expect(repos.concepts.findByName(b.id, 'vectors')).toBeNull()
      expect(repos.concepts.findByName(a.id, '  VECTORS')?.name).toBe('Vectors')
    })

    it('updates a patch and rejects unknown ids', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
      const u = repos.concepts.update(c.id, {
        mastery: 0.45,
        box: 2,
        nextReviewAt: '2026-10-26T09:00:00.000Z',
        status: 'learning',
        struggleCount: 1,
        lastSeenAt: '2026-10-24T09:00:00.000Z',
        summary: 'Unimolecular',
      })
      expect(u).toEqual({ ...c, ...u, id: c.id, subjectId: s.id, name: 'SN1' })
      expect(repos.concepts.get(c.id)).toEqual(u)
      expect(u.mastery).toBe(0.45)
      expect(() => repos.concepts.update('con_missing', { mastery: 1 })).toThrow(/not found/)
    })

    it('lists due concepts, most overdue first, up to the limit', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const mk = (name: string, nextReviewAt: string | null) =>
        repos.concepts.update(repos.concepts.upsert({ subjectId: s.id, name }).id, { nextReviewAt })
      mk('later', '2026-10-25T09:00:00.000Z')
      const b = mk('b', '2026-10-23T09:00:00.000Z')
      const a = mk('a', '2026-10-20T09:00:00.000Z')
      const now = mk('now', '2026-10-24T09:00:00.000Z')
      mk('never', null)
      expect(repos.concepts.listDue('2026-10-24T09:00:00.000Z', 10).map((c) => c.id)).toEqual([
        a.id,
        b.id,
        now.id,
      ])
      expect(repos.concepts.listDue('2026-10-24T09:00:00.000Z', 2).map((c) => c.id)).toEqual([
        a.id,
        b.id,
      ])
    })

    it('lists struggling concepts by struggle count, then lowest mastery', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const mk = (name: string, struggleCount: number, mastery: number, status = 'struggling') =>
        repos.concepts.update(repos.concepts.upsert({ subjectId: s.id, name }).id, {
          struggleCount,
          mastery,
          status: status as 'struggling',
        })
      const low = mk('low', 1, 0.5)
      const high = mk('high', 3, 0.4)
      const weaker = mk('weaker', 1, 0.2)
      mk('fine', 9, 0.1, 'learning')
      expect(repos.concepts.listStruggling(10).map((c) => c.id)).toEqual([
        high.id,
        weaker.id,
        low.id,
      ])
      expect(repos.concepts.listStruggling(1).map((c) => c.id)).toEqual([high.id])
    })
  })
}
