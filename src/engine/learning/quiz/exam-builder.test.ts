import type { ExamInput, QuestionDraft } from '@engine/brain-contract'
import { FakeBrain } from '@engine/testing/fake-brain'
import type { Concept, ExamSpec } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { interleaveBySubject, planSlots, selectExamConcepts } from './exam-builder'
import { quizWorld, variedBrain } from './quiz-fixtures'

const spec = (patch: Partial<ExamSpec> & Pick<ExamSpec, 'subjectIds'>): ExamSpec => ({
  count: 10,
  focus: 'weak',
  difficulty: 'mixed',
  ...patch,
})

describe('exam concept selection', () => {
  const now = '2026-10-24T09:00:00.000Z'
  const c = (name: string, patch: Partial<Concept> = {}): Concept => ({
    id: `con_${name}`,
    subjectId: 'sub_a',
    parentId: null,
    name,
    summary: '',
    mastery: 0.6,
    box: 2,
    nextReviewAt: '2026-10-30T04:00:00.000Z',
    status: 'learning',
    struggleCount: 0,
    lastSeenAt: null,
    ...patch,
  })
  const pool = [
    c('solid', { mastery: 0.9, status: 'mastered' }),
    c('shaky', { mastery: 0.3 }),
    c('struggling', { mastery: 0.55, status: 'struggling', struggleCount: 2 }),
    c('due', { nextReviewAt: '2026-10-24T04:00:00.000Z' }),
  ]

  it('picks weak spots, due reviews or everything', () => {
    expect(selectExamConcepts(pool, 'weak', now).map((x) => x.name)).toEqual([
      'struggling',
      'shaky',
    ])
    expect(selectExamConcepts(pool, 'due', now).map((x) => x.name)).toEqual(['due'])
    expect(selectExamConcepts(pool, 'everything', now).map((x) => x.name)).toEqual([
      'struggling',
      'shaky',
      'due',
      'solid',
    ])
    const allSolid = [c('solid', { mastery: 0.9 })]
    expect(selectExamConcepts(allSolid, 'due', now).map((x) => x.name)).toEqual(['solid'])
  })

  it('interleaves subjects and plans one slot per question', () => {
    const mixed = [c('a1'), c('a2'), c('b1', { subjectId: 'sub_b' }), c('a3')]
    expect(interleaveBySubject(mixed).map((x) => x.name)).toEqual(['a1', 'b1', 'a2', 'a3'])
    expect(planSlots(['x', 'y'], 5)).toEqual(['x', 'y', 'x', 'y', 'x'])
    expect(planSlots([], 5)).toEqual([])
  })
})

describe('QuizService.createExam', () => {
  it('returns at once as generating, then fills in verified questions in batches of 5', async () => {
    const w = quizWorld()
    for (const name of ['SN1', 'SN2', 'E1', 'E2'])
      w.concept(name, { mastery: 0.2, status: 'learning' })
    w.concept('Strong', { mastery: 0.95, box: 4, status: 'mastered' })
    const quiz = await w.quizzes.createExam(spec({ subjectIds: [w.subject.id], count: 20 }))
    expect(quiz).toMatchObject({ kind: 'exam', status: 'generating', questions: [] })
    expect(quiz.title).toBe('Organic Chemistry · weak spots · 20 questions')
    expect(w.quizzes.get(quiz.id).status).toBe('generating')

    await w.quizzes.settled()
    const ready = w.quizzes.get(quiz.id)
    expect(ready.status).toBe('ready')
    expect(ready.questions).toHaveLength(20)
    expect(ready.questions.every((q) => q.conceptId !== null)).toBe(true)
    expect(new Set(ready.questions.map((q) => q.conceptName))).toEqual(
      new Set(['SN1', 'SN2', 'E1', 'E2']),
    )

    const examCalls = (w.brain as FakeBrain).calls.filter((c) => c.method === 'makeExam')
    expect(examCalls).toHaveLength(4)
    for (const call of examCalls) {
      const input = call.input as ExamInput
      expect(input.spec.count).toBe(5)
      expect(input.concepts.length).toBeLessThanOrEqual(5)
    }
    const changes = w.events.filter((e) => e.name === 'memory:changed')
    expect(changes).toEqual([
      { name: 'memory:changed', payload: { scope: 'quizzes', ids: [quiz.id] } },
      { name: 'memory:changed', payload: { scope: 'quizzes', ids: [quiz.id] } },
    ])
  })

  it('regenerates a question the verifier disagrees with, and drops a hopeless one', async () => {
    let verifyRound = 0
    const brain = variedBrain({
      verifyQuestions: async (qs) => {
        verifyRound++
        return qs.map((q, index) => {
          const hopeless = q.concept === 'E1'
          const firstPassMiss = verifyRound === 1 && q.concept === 'SN2'
          const wrong = hopeless || firstPassMiss
          return {
            index,
            chosen: wrong ? (q.correctIndex + 1) % 4 : q.correctIndex,
            confidence: 0.8,
          }
        })
      },
    })
    const w = quizWorld({ brain })
    for (const name of ['SN1', 'SN2', 'E1']) w.concept(name, { mastery: 0.1, status: 'learning' })
    const quiz = await w.quizzes.createExam(spec({ subjectIds: [w.subject.id], count: 5 }))
    await w.quizzes.settled()
    const done = w.quizzes.get(quiz.id)
    expect(done.status).toBe('ready')
    // Slots SN1, SN2, E1, SN1, SN2: both SN2 questions are regenerated once; E1 never verifies.
    expect(done.questions.map((q) => q.conceptName).sort()).toEqual(['SN1', 'SN1', 'SN2', 'SN2'])
    const regen = brain.calls.filter((c) => c.method === 'makeCheckpoint')
    expect(regen.length).toBeGreaterThanOrEqual(2)
    expect(brain.calls.filter((c) => c.method === 'verifyQuestions')).toHaveLength(3)
  })

  it('marks the exam failed when no batch can be generated', async () => {
    const brain = new FakeBrain({
      makeExam: async (): Promise<QuestionDraft[]> => {
        throw new Error('all providers down')
      },
    })
    const w = quizWorld({ brain })
    w.concept('SN1')
    const quiz = await w.quizzes.createExam(spec({ subjectIds: [w.subject.id], count: 10 }))
    await w.quizzes.settled()
    expect(w.quizzes.get(quiz.id).status).toBe('failed')
    expect(brain.calls.filter((c) => c.method === 'makeExam')).toHaveLength(2)
  })

  it('works for a subject without concepts and validates the spec', async () => {
    const w = quizWorld()
    const quiz = await w.quizzes.createExam(
      spec({ subjectIds: [w.subject.id], count: 5, focus: 'everything' }),
    )
    await w.quizzes.settled()
    expect(w.quizzes.get(quiz.id).questions).toHaveLength(5)
    await expect(w.quizzes.createExam(spec({ subjectIds: ['sub_unknown'] }))).rejects.toThrow(
      /subject/,
    )
    await expect(
      w.quizzes.createExam({ ...spec({ subjectIds: [w.subject.id] }), count: 7 as 5 }),
    ).rejects.toThrow()
  })

  it('fails exams a previous run left generating', async () => {
    const w = quizWorld()
    const quiz = await w.quizzes.createExam(spec({ subjectIds: [w.subject.id], count: 5 }))
    expect(w.quizzes.recoverInterrupted()).toEqual([]) // its job is still running
    await w.quizzes.settled()
    w.repos.quizzes.save({ ...w.quizzes.get(quiz.id), status: 'generating' })
    expect(w.quizzes.recoverInterrupted()).toEqual([quiz.id])
    expect(w.quizzes.get(quiz.id).status).toBe('failed')
  })
})
