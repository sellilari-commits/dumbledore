/** Conformance: concept name matching (conceptKey) and folding duplicate concepts on merge. */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, encounterInput, quiz } from './fixtures'

export function conceptMatchingSuite(t: () => ConformanceTarget): void {
  describe('concept matching', () => {
    it('matches names ignoring case, spacing, punctuation and simple plurals', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chemistry' })
      const lg = repos.concepts.upsert({ subjectId: s.id, name: 'Leaving groups' })
      const nu = repos.concepts.upsert({ subjectId: s.id, name: 'Nucleophile' })
      const sn2 = repos.concepts.upsert({ subjectId: s.id, name: 'SN2 Mechanism' })
      const hess = repos.concepts.upsert({ subjectId: s.id, name: "Hess's law" })
      for (const name of ['Leaving Group', 'leaving-group', ' LEAVING  GROUPS ', 'leaving group.'])
        expect(repos.concepts.findByName(s.id, name)?.id).toBe(lg.id)
      expect(repos.concepts.upsert({ subjectId: s.id, name: 'nucleophiles' }).id).toBe(nu.id)
      expect(repos.concepts.upsert({ subjectId: s.id, name: 'SN2 mechanism' }).id).toBe(sn2.id)
      expect(repos.concepts.upsert({ subjectId: s.id, name: 'sn-2 mechanisms' }).id).toBe(sn2.id)
      expect(repos.concepts.findByName(s.id, 'Hess law')?.id).toBe(hess.id)
      expect(repos.concepts.listBySubject(s.id).map((c) => c.name)).toEqual([
        'Leaving groups',
        'Nucleophile',
        'SN2 Mechanism',
        "Hess's law",
      ])
    })

    it('keeps words that only look plural, and symbols, apart', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Mixed' })
      const names = ['Physics', 'Physic', 'Gas', 'Ga', 'Species', 'Specie', 'C++', 'C', 'Na+', 'Na']
      for (const name of names) repos.concepts.upsert({ subjectId: s.id, name })
      expect(repos.concepts.listBySubject(s.id).map((c) => c.name)).toEqual(names)
      expect(repos.concepts.findByName(s.id, 'gases')?.name).toBe('Gas')
      expect(repos.concepts.findByName(s.id, 'c')?.name).toBe('C')
    })

    it('keeps the existing name unless the new one is clearly nicer', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chemistry' })
      const lg = repos.concepts.upsert({ subjectId: s.id, name: 'Leaving groups' })
      expect(repos.concepts.upsert({ subjectId: s.id, name: 'Leaving Group' })).toEqual(lg)
      const nu = repos.concepts.upsert({ subjectId: s.id, name: 'nucleophiles' })
      const renamed = repos.concepts.upsert({
        subjectId: s.id,
        name: ' Nucleophile ',
        summary: 'x',
      })
      expect(renamed).toEqual({ ...nu, name: 'Nucleophile', summary: 'x' })
      expect(repos.concepts.get(nu.id)?.name).toBe('Nucleophile')
      expect(repos.concepts.findByName(s.id, 'nucleophile')?.id).toBe(nu.id)
    })

    it('never makes a concept its own parent', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1', parentName: 'sn1' })
      expect(c.parentId).toBeNull()
      const g = repos.concepts.upsert({ subjectId: s.id, name: 'Groups', parentName: 'group' })
      expect(g.parentId).toBeNull()
      expect(repos.concepts.listBySubject(s.id)).toHaveLength(2)
    })
  })

  describe('merge folds equal concepts', () => {
    it('combines stats and re-points encounters, questions and review actions', () => {
      const { repos } = t()
      const from = repos.subjects.create({ name: 'SN1 and SN2 reactions differ' })
      const into = repos.subjects.create({ name: 'Chemistry' })
      const nu = repos.concepts.update(
        repos.concepts.upsert({ subjectId: into.id, name: 'Nucleophile', summary: '' }).id,
        {
          mastery: 0.3,
          box: 1,
          nextReviewAt: '2026-10-28T04:00:00.000Z',
          status: 'learning',
          struggleCount: 1,
          lastSeenAt: '2026-10-20T09:00:00.000Z',
        },
      )
      const dup = repos.concepts.update(
        repos.concepts.upsert({ subjectId: from.id, name: 'nucleophiles', summary: 'Donates' }).id,
        {
          mastery: 0.5,
          box: 2,
          nextReviewAt: '2026-10-26T04:00:00.000Z',
          status: 'struggling',
          struggleCount: 2,
          lastSeenAt: '2026-10-22T09:00:00.000Z',
        },
      )
      const child = repos.concepts.upsert({
        subjectId: from.id,
        name: 'Strong nucleophiles',
        parentName: 'nucleophiles',
      })
      const enc = repos.encounters.add(encounterInput({ subjectId: from.id, conceptId: dup.id }))
      const q = quiz({ subjectIds: [from.id] })
      repos.quizzes.save({
        ...q,
        questions: q.questions.map((x, i) => ({ ...x, conceptId: i === 0 ? dup.id : nu.id })),
      })
      const msg = repos.chat.append({
        thread: 'coach',
        role: 'assistant',
        content: 'Review?',
        actions: [{ type: 'start_review', conceptIds: [dup.id, nu.id] }],
      })
      const nudge = repos.nudges.add({
        kind: 'review_due',
        title: 'Review',
        body: '1 due',
        action: { type: 'start_review', conceptIds: [dup.id] },
        dedupeKey: 'review',
      })

      repos.subjects.merge(from.id, into.id)

      expect(repos.concepts.get(dup.id)).toBeNull()
      expect(repos.concepts.get(nu.id)).toEqual({
        ...nu,
        summary: 'Donates',
        mastery: 0.5,
        box: 2,
        nextReviewAt: '2026-10-26T04:00:00.000Z',
        status: 'struggling',
        struggleCount: 3,
        lastSeenAt: '2026-10-22T09:00:00.000Z',
      })
      expect(repos.concepts.get(child.id)).toMatchObject({ subjectId: into.id, parentId: nu.id })
      expect(repos.encounters.list({}).map((e) => [e.id, e.subjectId, e.conceptId])).toEqual([
        [enc.id, into.id, nu.id],
      ])
      expect(repos.quizzes.get(q.id)?.questions.map((x) => x.conceptId)).toEqual([nu.id, nu.id])
      expect(repos.chat.history('coach', 5).find((m) => m.id === msg.id)?.actions).toEqual([
        { type: 'start_review', conceptIds: [nu.id] },
      ])
      expect(repos.nudges.listSince(nudge.createdAt)[0]?.action).toEqual({
        type: 'start_review',
        conceptIds: [nu.id],
      })
    })

    it('folds look-alike names into the target and moves the rest', () => {
      const { repos } = t()
      const from = repos.subjects.create({ name: 'Orgo' })
      const into = repos.subjects.create({ name: 'Chemistry' })
      const lg = repos.concepts.upsert({ subjectId: into.id, name: 'Leaving groups' })
      const sn2 = repos.concepts.upsert({ subjectId: into.id, name: 'SN2 Mechanism' })
      repos.concepts.upsert({ subjectId: from.id, name: 'leaving group' })
      repos.concepts.upsert({ subjectId: from.id, name: 'SN2 mechanism' })
      const back = repos.concepts.upsert({ subjectId: from.id, name: 'backside attack' })
      const again = repos.concepts.upsert({ subjectId: from.id, name: 'Backside-attack' })
      expect(again.id).toBe(back.id)

      repos.subjects.merge(from.id, into.id)

      expect(repos.concepts.listBySubject(into.id).map((c) => [c.id, c.name])).toEqual([
        [lg.id, 'Leaving groups'],
        [sn2.id, 'SN2 Mechanism'],
        [back.id, 'Backside-attack'],
      ])
    })

    it('treats merging a subject into itself as a no-op', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const c = repos.concepts.upsert({ subjectId: s.id, name: 'SN1' })
      repos.subjects.merge(s.id, s.id)
      expect(repos.subjects.get(s.id)).toEqual(s)
      expect(repos.concepts.listBySubject(s.id)).toEqual([c])
      expect(() => repos.subjects.merge('sub_missing', 'sub_missing')).toThrow(/not found/)
    })
  })
}
