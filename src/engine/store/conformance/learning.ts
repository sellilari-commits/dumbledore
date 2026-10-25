/** Conformance: RoadmapRepo and QuizRepo. */
import { describe, expect, it } from 'vitest'
import { type ConformanceTarget, quiz, roadmap } from './fixtures'

export function learningSuite(t: () => ConformanceTarget): void {
  describe('roadmaps', () => {
    it('saves and reads back items of both kinds; save replaces', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const r = roadmap(s.id)
      repos.roadmaps.save(r)
      expect(repos.roadmaps.get(r.id)).toEqual(r)
      const next = { ...r, status: 'paused' as const, items: r.items.slice(1), carry: [] }
      repos.roadmaps.save(next)
      expect(repos.roadmaps.get(r.id)).toEqual(next)
      expect(repos.roadmaps.get('rdm_missing')).toBeNull()
    })

    it('finds the active (not done) roadmap, newest update first', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const other = repos.subjects.create({ name: 'Bio' })
      repos.roadmaps.save(
        roadmap(s.id, { id: 'rdm_done', status: 'done', updatedAt: '2026-10-24T12:00:00.000Z' }),
      )
      repos.roadmaps.save(roadmap(s.id, { id: 'rdm_old', updatedAt: '2026-10-22T12:00:00.000Z' }))
      repos.roadmaps.save(
        roadmap(s.id, {
          id: 'rdm_paused',
          status: 'paused',
          updatedAt: '2026-10-23T12:00:00.000Z',
        }),
      )
      expect(repos.roadmaps.getActive(s.id)?.id).toBe('rdm_paused')
      expect(repos.roadmaps.getActive(other.id)).toBeNull()
    })

    it('lists by subject (newest created first) and active ones (newest update first)', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const b = repos.subjects.create({ name: 'Bio' })
      repos.roadmaps.save(
        roadmap(s.id, {
          id: 'rdm_1',
          createdAt: '2026-10-20T00:00:00.000Z',
          updatedAt: '2026-10-24T00:00:00.000Z',
        }),
      )
      repos.roadmaps.save(
        roadmap(s.id, {
          id: 'rdm_2',
          createdAt: '2026-10-21T00:00:00.000Z',
          updatedAt: '2026-10-21T00:00:00.000Z',
          status: 'done',
        }),
      )
      repos.roadmaps.save(
        roadmap(b.id, {
          id: 'rdm_3',
          createdAt: '2026-10-22T00:00:00.000Z',
          updatedAt: '2026-10-22T00:00:00.000Z',
        }),
      )
      expect(repos.roadmaps.listBySubject(s.id).map((r) => r.id)).toEqual(['rdm_2', 'rdm_1'])
      expect(repos.roadmaps.listActive().map((r) => r.id)).toEqual(['rdm_1', 'rdm_3'])
    })

    it('keeps superseded roadmaps as history, hidden from the current reads', () => {
      const { repos } = t()
      const s = repos.subjects.create({ name: 'Chem' })
      const old = roadmap(s.id, { id: 'rdm_old', createdAt: '2026-10-20T00:00:00.000Z' })
      const older = roadmap(s.id, { id: 'rdm_older', createdAt: '2026-10-19T00:00:00.000Z' })
      const now = roadmap(s.id, { id: 'rdm_now', createdAt: '2026-10-21T00:00:00.000Z' })
      for (const r of [older, old, now]) repos.roadmaps.save(r)
      repos.roadmaps.supersede('rdm_older', {
        at: '2026-10-20T00:00:00.000Z',
        by: 'rdm_old',
        reason: 'New roadmap: B',
      })
      repos.roadmaps.supersede('rdm_old', {
        at: '2026-10-21T00:00:00.000Z',
        by: 'rdm_now',
        reason: 'Replanned: skip SN2',
      })
      expect(repos.roadmaps.listBySubject(s.id).map((r) => r.id)).toEqual(['rdm_now'])
      expect(repos.roadmaps.listActive().map((r) => r.id)).toEqual(['rdm_now'])
      expect(repos.roadmaps.getActive(s.id)?.id).toBe('rdm_now')
      expect(repos.roadmaps.history(s.id)).toEqual([
        {
          roadmap: old,
          replacedAt: '2026-10-21T00:00:00.000Z',
          replacedBy: 'rdm_now',
          reason: 'Replanned: skip SN2',
        },
        {
          roadmap: older,
          replacedAt: '2026-10-20T00:00:00.000Z',
          replacedBy: 'rdm_old',
          reason: 'New roadmap: B',
        },
      ])
      expect(repos.roadmaps.get('rdm_old')).toEqual(old)
      expect(repos.roadmaps.version('rdm_now')).toBeNull()
      expect(repos.roadmaps.version('rdm_old')?.reason).toBe('Replanned: skip SN2')
      // Saving a superseded roadmap (a late quiz id) keeps it in the history.
      repos.roadmaps.save({ ...old, carry: ['SN2'] })
      expect(repos.roadmaps.version('rdm_old')?.roadmap.carry).toEqual(['SN2'])
      expect(repos.roadmaps.getActive(s.id)?.id).toBe('rdm_now')

      repos.roadmaps.unsupersede('rdm_old')
      expect(repos.roadmaps.version('rdm_old')).toBeNull()
      expect(repos.roadmaps.listBySubject(s.id).map((r) => r.id)).toEqual(['rdm_now', 'rdm_old'])
      expect(repos.roadmaps.history(s.id).map((v) => v.roadmap.id)).toEqual(['rdm_older'])
    })
  })

  describe('quizzes', () => {
    it('saves and reads back questions and answers; save replaces', () => {
      const { repos } = t()
      const q = quiz({
        subjectIds: ['sub_a'],
        answers: [
          {
            questionId: 'qst_1',
            chosenIndex: 0,
            correct: true,
            answeredAt: '2026-10-24T09:01:00.000Z',
          },
        ],
        score: 0.5,
        status: 'done',
        completedAt: '2026-10-24T09:05:00.000Z',
      })
      repos.quizzes.save(q)
      expect(repos.quizzes.get(q.id)).toEqual(q)
      const next = { ...q, title: 'Renamed', questions: q.questions.slice(0, 1), answers: [] }
      repos.quizzes.save(next)
      expect(repos.quizzes.get(q.id)).toEqual(next)
      expect(repos.quizzes.get('quz_missing')).toBeNull()
    })

    it('lists newest first, filtered by kind and subject, up to the limit', () => {
      const { repos } = t()
      repos.quizzes.save(
        quiz({
          id: 'quz_a',
          kind: 'exam',
          subjectIds: ['sub_1'],
          createdAt: '2026-10-20T00:00:00.000Z',
        }),
      )
      repos.quizzes.save(
        quiz({
          id: 'quz_b',
          kind: 'review',
          subjectIds: ['sub_1', 'sub_2'],
          createdAt: '2026-10-22T00:00:00.000Z',
        }),
      )
      repos.quizzes.save(
        quiz({
          id: 'quz_c',
          kind: 'exam',
          subjectIds: ['sub_2'],
          createdAt: '2026-10-21T00:00:00.000Z',
        }),
      )
      expect(repos.quizzes.list({}).map((q) => q.id)).toEqual(['quz_b', 'quz_c', 'quz_a'])
      expect(repos.quizzes.list({ kind: 'exam' }).map((q) => q.id)).toEqual(['quz_c', 'quz_a'])
      expect(repos.quizzes.list({ subjectId: 'sub_2' }).map((q) => q.id)).toEqual([
        'quz_b',
        'quz_c',
      ])
      expect(repos.quizzes.list({ limit: 1 }).map((q) => q.id)).toEqual(['quz_b'])
    })

    it('records answers, replacing an earlier answer to the same question', () => {
      const { repos } = t()
      repos.quizzes.save(quiz())
      const a1 = {
        questionId: 'qst_1',
        chosenIndex: 2,
        correct: false,
        answeredAt: '2026-10-24T09:01:00.000Z',
      }
      const a2 = {
        questionId: 'qst_2',
        chosenIndex: 1,
        correct: true,
        answeredAt: '2026-10-24T09:02:00.000Z',
      }
      const a1b = { ...a1, chosenIndex: 0, correct: true, answeredAt: '2026-10-24T09:03:00.000Z' }
      expect(repos.quizzes.recordAnswer('quz_1', a1).status).toBe('in_progress')
      repos.quizzes.recordAnswer('quz_1', a2)
      const after = repos.quizzes.recordAnswer('quz_1', a1b)
      expect(after.answers).toEqual([a2, a1b])
      expect(repos.quizzes.get('quz_1')).toEqual(after)
      repos.quizzes.save(quiz({ id: 'quz_done', status: 'done' }))
      expect(repos.quizzes.recordAnswer('quz_done', a1).status).toBe('done')
      expect(() => repos.quizzes.recordAnswer('quz_missing', a1)).toThrow(/not found/)
    })
  })
}
