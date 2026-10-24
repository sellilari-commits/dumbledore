/** Conformance: SearchRepo (substring semantics, hit shapes, ordering) and transaction(). */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, encounterInput, quiz } from './fixtures'

export function searchSuite(t: () => ConformanceTarget): void {
  describe('search', () => {
    const seed = (target: ConformanceTarget) => {
      const { repos } = target
      const chem = repos.subjects.create({
        name: 'Organic Chemistry',
        emoji: '🧪',
        goal: 'Pass the carbocation-heavy midterm',
      })
      const bio = repos.subjects.create({
        name: 'Biology',
        description: 'Cells and  Carbon cycles',
      })
      const concept = repos.concepts.upsert({
        subjectId: chem.id,
        name: 'Carbocation stability',
        summary: 'Tertiary > secondary > primary',
      })
      const enc = repos.encounters.add(
        encounterInput({
          subjectId: chem.id,
          seen: 'Carbocations are stabilised by hyperconjugation',
        }),
      )
      const inbox = repos.encounters.add(
        encounterInput({
          topicPath: [],
          source: { app: 'Preview', bundleId: null, url: null, title: 'Lecture 7.pdf' },
          seen: 'carbocation rearrangements',
        }),
      )
      const ignored = repos.encounters.add(
        encounterInput({ seen: 'carbocation trivia', inboxState: 'ignored' }),
      )
      repos.quizzes.save(quiz({ id: 'quz_exam', title: 'Carbocation exam', subjectIds: [chem.id] }))
      repos.quizzes.save(quiz({ id: 'quz_review', kind: 'review', title: 'Carbocation review' }))
      return { chem, bio, concept, enc, inbox, ignored }
    }

    it('returns nothing for a blank query', () => {
      const target = t()
      seed(target)
      expect(target.repos.search.query('   ', 10)).toEqual([])
    })

    it('matches substrings case- and whitespace-insensitively, grouped by kind', () => {
      const target = t()
      const { chem, bio, concept, enc, inbox } = seed(target)
      const hits = target.repos.search.query('  CARBO ', 20)
      expect(hits).toEqual([
        {
          kind: 'subject',
          id: chem.id,
          title: '🧪 Organic Chemistry',
          snippet: 'Pass the carbocation-heavy midterm',
          subjectId: chem.id,
          route: `/subjects/${chem.id}/roadmap`,
        },
        {
          kind: 'subject',
          id: bio.id,
          title: '📘 Biology',
          snippet: 'Cells and  Carbon cycles',
          subjectId: bio.id,
          route: `/subjects/${bio.id}/roadmap`,
        },
        {
          kind: 'concept',
          id: concept.id,
          title: 'Carbocation stability',
          snippet: 'Tertiary > secondary > primary',
          subjectId: chem.id,
          route: `/subjects/${chem.id}/concepts`,
        },
        {
          kind: 'encounter',
          id: enc.id,
          title: 'SN1',
          snippet: 'Carbocations are stabilised by hyperconjugation',
          subjectId: chem.id,
          route: `/subjects/${chem.id}/seen`,
        },
        {
          kind: 'encounter',
          id: inbox.id,
          title: 'Lecture 7.pdf',
          snippet: 'carbocation rearrangements',
          subjectId: null,
          route: '/inbox',
        },
        {
          kind: 'exam',
          id: 'quz_exam',
          title: 'Carbocation exam',
          snippet: '2 questions',
          subjectId: chem.id,
          route: '/exams/quz_exam',
        },
      ])
      expect(target.repos.search.query('carbo', 2).map((h) => h.id)).toEqual([chem.id, bio.id])
    })

    it('matches inside words, across collapsed whitespace and with short queries', () => {
      const target = t()
      const { bio, concept, enc } = seed(target)
      expect(target.repos.search.query('cation stab', 10).map((h) => h.id)).toEqual([concept.id])
      expect(target.repos.search.query('and carbon', 10).map((h) => h.id)).toEqual([bio.id])
      expect(target.repos.search.query('hyperconj', 10).map((h) => h.id)).toEqual([enc.id])
      expect(target.repos.search.query('>', 10).map((h) => h.id)).toEqual([concept.id])
      expect(target.repos.search.query('sn', 10).map((h) => h.kind)).toContain('encounter')
      expect(target.repos.search.query('zzz', 10)).toEqual([])
    })

    it('follows updates, inbox state changes and merges', () => {
      const target = t()
      const { repos } = target
      const { chem, bio, concept, enc } = seed(target)
      repos.subjects.update(bio.id, { name: 'Cell Biology', description: '' })
      expect(repos.search.query('cell biology', 10).map((h) => h.id)).toEqual([bio.id])
      expect(repos.search.query('carbon cycles', 10)).toEqual([])
      repos.concepts.update(concept.id, { summary: 'Hyperconjugation and induction' })
      expect(repos.search.query('induction', 10).map((h) => h.id)).toEqual([concept.id])
      repos.encounters.setInboxState(enc.id, 'ignored')
      expect(repos.search.query('hyperconjugation', 10).map((h) => h.id)).toEqual([concept.id])
      repos.subjects.merge(bio.id, chem.id)
      expect(repos.search.query('cell biology', 10)).toEqual([])
    })
  })

  describe('transaction', () => {
    it('runs the function and returns its value', () => {
      const { repos } = t()
      const id = repos.transaction(() => {
        const s = repos.subjects.create({ name: 'Chem' })
        repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
        return s.id
      })
      expect(repos.concepts.listBySubject(id)).toHaveLength(1)
    })
  })
}
