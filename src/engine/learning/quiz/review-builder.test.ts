import type { CheckpointInput } from '@engine/brain-contract'
import type { FakeBrain } from '@engine/testing/fake-brain'
import { describe, expect, it } from 'vitest'
import { makeQuestion, quizWorld, saveQuiz, variedBrain } from './quiz-fixtures'

const due = '2026-10-24T04:00:00.000Z'
const later = '2026-10-30T04:00:00.000Z'

describe('QuizService.startReview', () => {
  it('reviews due concepts (≤ 8), one question each, in batches of ≤ 5', async () => {
    const w = quizWorld()
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J']
    for (const [i, n] of names.entries()) {
      w.concept(n, {
        box: 1,
        mastery: 0.4,
        status: 'learning',
        nextReviewAt: `2026-10-2${i < 5 ? 3 : 4}T04:00:00.000Z`,
      })
    }
    w.concept('Not due', { box: 2, nextReviewAt: later })
    const quiz = await w.quizzes.startReview([])
    expect(quiz).toMatchObject({ kind: 'review', status: 'ready', subjectIds: [w.subject.id] })
    expect(quiz.questions).toHaveLength(8)
    expect(new Set(quiz.questions.map((q) => q.conceptId)).size).toBe(8)
    expect(quiz.questions.some((q) => q.conceptName === 'Not due')).toBe(false)
    expect(quiz.title).toMatch(/^Review · \w, \w \+6$/)
    const calls = (w.brain as FakeBrain).calls.filter((c) => c.method === 'makeCheckpoint')
    expect(calls.map((c) => (c.input as CheckpointInput).n)).toEqual([5, 3])
    expect(w.quizzes.get(quiz.id)).toEqual(quiz)
    expect(w.events).toContainEqual({
      name: 'memory:changed',
      payload: { scope: 'quizzes', ids: [quiz.id] },
    })
  })

  it('asks at least three questions and re-tests struggling concepts as carry', async () => {
    const w = quizWorld()
    const tricky = w.concept('Carbocations', {
      status: 'struggling',
      struggleCount: 2,
      box: 1,
      nextReviewAt: due,
    })
    const quiz = await w.quizzes.startReview([tricky.id])
    expect(quiz.questions).toHaveLength(3)
    expect(quiz.questions.every((q) => q.conceptId === tricky.id)).toBe(true)
    const input = (w.brain as FakeBrain).calls.find((c) => c.method === 'makeCheckpoint')
      ?.input as CheckpointInput
    expect(input).toMatchObject({ concepts: ['Carbocations'], carry: ['Carbocations'], n: 3 })
  })

  it('falls back to struggling concepts, then refuses when there is nothing to review', async () => {
    const w = quizWorld()
    await expect(w.quizzes.startReview([])).rejects.toThrow(/Nothing to review/)
    const s = w.concept('Leaving groups', { status: 'struggling', struggleCount: 1 })
    const quiz = await w.quizzes.startReview([])
    expect(quiz.questions.every((q) => q.conceptId === s.id)).toBe(true)
  })

  it('reuses earlier questions when the LLM is down', async () => {
    const brain = variedBrain({
      makeCheckpoint: async () => {
        throw new Error('offline')
      },
    })
    const w = quizWorld({ brain })
    const sn1 = w.concept('SN1', { box: 1, nextReviewAt: due })
    const e1 = w.concept('E1', { box: 1, nextReviewAt: due })
    const old = makeQuestion(sn1, 2)
    saveQuiz(w.repos, 'checkpoint', [old], [w.subject.id])

    const quiz = await w.quizzes.startReview([sn1.id, e1.id])
    expect(quiz.status).toBe('ready')
    expect(quiz.questions).toHaveLength(1)
    expect(quiz.questions[0]).toMatchObject({
      conceptId: sn1.id,
      stem: old.stem,
      carriedFrom: old.id,
    })
    expect(quiz.questions[0]?.id).not.toBe(old.id)

    const empty = await w.quizzes.startReview([e1.id])
    expect(empty).toMatchObject({ status: 'failed', questions: [] })
  })

  it('takes the review through answers and finish into the Leitner schedule', async () => {
    const w = quizWorld()
    const sn1 = w.concept('SN1', { box: 1, mastery: 0.3, status: 'learning', nextReviewAt: due })
    const quiz = await w.quizzes.startReview([sn1.id])
    for (const q of quiz.questions) w.quizzes.answer(quiz.id, q.id, q.correctIndex)
    const result = await w.quizzes.finish(quiz.id)
    expect(result.score).toBe(1)
    // Only the first pass on the due review moves the box; the other two are not spaced.
    expect(w.repos.concepts.get(sn1.id)).toMatchObject({
      box: 2,
      nextReviewAt: '2026-10-27T04:00:00.000Z',
    })
  })
})
