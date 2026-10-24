import { FakeBrain } from '@engine/testing/fake-brain'
import type { QuizResult } from '@shared/domain'
import { describe, expect, it, vi } from 'vitest'
import { makeQuestion, quizWorld, saveQuiz } from './quiz-fixtures'
import { FIX_PROMPT_MAX_WORDS } from './quiz-results'

describe('QuizService.answer', () => {
  it('records the answer and returns the chosen option rationale', () => {
    const w = quizWorld()
    const sn1 = w.concept('SN1')
    const q = makeQuestion(sn1, 0)
    const quiz = saveQuiz(w.repos, 'review', [q], [w.subject.id])

    expect(w.quizzes.answer(quiz.id, q.id, 2)).toEqual({
      correct: false,
      correctIndex: 0,
      rationale: 'C ignores the rate law.',
    })
    expect(w.quizzes.answer(quiz.id, q.id, 0)).toEqual({
      correct: true,
      correctIndex: 0,
      rationale: 'Because A.',
    })
    const stored = w.quizzes.get(quiz.id)
    expect(stored.status).toBe('in_progress')
    expect(stored.answers).toEqual([
      { questionId: q.id, chosenIndex: 0, correct: true, answeredAt: '2026-10-24T09:00:00.000Z' },
    ])
  })

  it('rejects unknown questions, bad options and closed quizzes', async () => {
    const w = quizWorld()
    const q = makeQuestion(w.concept('SN1'))
    const quiz = saveQuiz(w.repos, 'review', [q], [w.subject.id])
    expect(() => w.quizzes.answer(quiz.id, 'qst_nope', 0)).toThrow(/not in quiz/)
    expect(() => w.quizzes.answer(quiz.id, q.id, 4)).toThrow(/invalid option/)
    expect(() => w.quizzes.answer('quz_nope', q.id, 0)).toThrow(/not found/)
    await w.quizzes.finish(quiz.id)
    expect(() => w.quizzes.answer(quiz.id, q.id, 0)).toThrow(/not open/)
  })
})

describe('QuizService.finish', () => {
  it('scores, updates mastery for every answer, diagnoses gaps and closes the quiz', async () => {
    const w = quizWorld()
    const sn1 = w.concept('SN1')
    const e1 = w.concept('E1', {
      mastery: 0.5,
      box: 2,
      nextReviewAt: '2026-10-24T04:00:00.000Z',
      status: 'learning',
    })
    const qs = [makeQuestion(sn1, 0), makeQuestion(sn1, 1), makeQuestion(e1, 2)]
    const quiz = saveQuiz(w.repos, 'review', qs, [w.subject.id])
    w.quizzes.answer(quiz.id, qs[0]?.id ?? '', 0) // right
    w.clock.advance(30_000)
    w.quizzes.answer(quiz.id, qs[1]?.id ?? '', 3) // wrong
    w.clock.advance(30_000)
    w.quizzes.answer(quiz.id, qs[2]?.id ?? '', 2) // right, review due → box 3

    const result = await w.quizzes.finish(quiz.id)
    expect(result).toMatchObject({ quizId: quiz.id, correct: 2, total: 3, score: 0.6667 })
    expect(result.byConcept).toEqual([
      { conceptName: 'SN1', correct: 1, total: 2, status: 'struggling' },
      { conceptName: 'E1', correct: 1, total: 1, status: 'learning' },
    ])
    expect(w.repos.concepts.get(sn1.id)).toMatchObject({ mastery: 0.18, box: 1, struggleCount: 1 })
    expect(w.repos.concepts.get(e1.id)).toMatchObject({ mastery: 0.65, box: 3 })
    expect(result.gaps).toEqual([{ concept: 'SN1', misconception: 'Chose "Option D"' }])
    expect(result.fixPrompt).toContain('Then quiz me with 2 new questions')
    expect(result.nextTopic).toBe('SN1 in practice')
    expect(w.quizzes.get(quiz.id)).toMatchObject({
      status: 'done',
      score: 0.6667,
      completedAt: '2026-10-24T09:01:00.000Z',
    })
    expect(w.events).toEqual(
      expect.arrayContaining([
        { name: 'memory:changed', payload: { scope: 'quizzes', ids: [quiz.id] } },
        { name: 'memory:changed', payload: { scope: 'concepts', ids: [sn1.id, e1.id] } },
      ]),
    )
    const gapCall = (w.brain as FakeBrain).calls.find((c) => c.method === 'fixGaps')
    expect(gapCall?.input).toMatchObject({
      assistant: 'ChatGPT',
      misses: [
        { concept: 'SN1', chosen: 'Option D', correct: 'Option B', rationale: 'D is the reverse.' },
      ],
    })
  })

  it('falls back to a templated repair prompt without the LLM', async () => {
    const brain = new FakeBrain({
      fixGaps: async () => {
        throw new Error('rate limited')
      },
    })
    const w = quizWorld({ brain })
    const names = [
      'Carbocation stability under hyperconjugation',
      'Leaving groups',
      'Solvent effects',
      'SN2',
    ]
    const qs = names.map((n) => makeQuestion(w.concept(n), 0))
    const quiz = saveQuiz(w.repos, 'exam', qs, [w.subject.id])
    for (const q of qs) w.quizzes.answer(quiz.id, q.id, 1)
    const result = await w.quizzes.finish(quiz.id)
    expect(result.score).toBe(0)
    expect(result.gaps).toHaveLength(4)
    expect(result.gaps[0]).toEqual({
      concept: 'Carbocation stability under hyperconjugation',
      misconception: 'B mixes up cause and effect.',
    })
    const prompt = result.fixPrompt ?? ''
    expect(prompt).toMatch(/^I'm studying Organic Chemistry\./)
    expect(prompt).toContain('No greetings or small talk')
    expect(prompt.trim().split(/\s+/).length).toBeLessThanOrEqual(FIX_PROMPT_MAX_WORDS)
    expect(result.nextTopic).toBe('Carbocation stability under hyperconjugation')
  })

  it('suggests an uncovered concept when everything was right', async () => {
    const w = quizWorld()
    const sn1 = w.concept('SN1')
    w.concept('Mastered thing', { mastery: 0.95, box: 4, status: 'mastered' })
    w.concept('Nucleophiles', { mastery: 0.3, status: 'learning' })
    const q = makeQuestion(sn1, 0)
    const quiz = saveQuiz(w.repos, 'review', [q], [w.subject.id])
    w.quizzes.answer(quiz.id, q.id, 0)
    const result = await w.quizzes.finish(quiz.id)
    expect(result).toMatchObject({ score: 1, gaps: [], fixPrompt: null, nextTopic: 'Nucleophiles' })
    expect((w.brain as FakeBrain).calls.some((c) => c.method === 'fixGaps')).toBe(false)
  })

  it('hands finished checkpoints to lane L4, but not exams', async () => {
    const seen: [string, QuizResult][] = []
    const w = quizWorld({ onCheckpoint: (id, result) => void seen.push([id, result]) })
    const sn1 = w.concept('SN1')
    const cp = saveQuiz(w.repos, 'checkpoint', [makeQuestion(sn1)], [w.subject.id])
    const exam = saveQuiz(w.repos, 'exam', [makeQuestion(sn1)], [w.subject.id])
    const result = await w.quizzes.finish(cp.id)
    await w.quizzes.finish(exam.id)
    expect(seen).toEqual([[cp.id, result]])

    const failing = vi.fn(async () => {
      throw new Error('session gone')
    })
    w.quizzes.setCheckpointHandler(failing)
    const cp2 = saveQuiz(w.repos, 'checkpoint', [makeQuestion(sn1)], [w.subject.id])
    await expect(w.quizzes.finish(cp2.id)).resolves.toMatchObject({ quizId: cp2.id })
    expect(failing).toHaveBeenCalledOnce()
  })

  it('applies mastery once even when finish is called twice', async () => {
    const w = quizWorld()
    const sn1 = w.concept('SN1')
    const q = makeQuestion(sn1)
    const quiz = saveQuiz(w.repos, 'review', [q], [w.subject.id])
    w.quizzes.answer(quiz.id, q.id, 0)
    const [a, b] = await Promise.all([w.quizzes.finish(quiz.id), w.quizzes.finish(quiz.id)])
    const c = await w.quizzes.finish(quiz.id)
    expect(a).toBe(b)
    expect(c).toEqual(a)
    expect(w.repos.concepts.get(sn1.id)?.mastery).toBe(0.3)
  })

  it('creates a concept for an untracked question topic', async () => {
    const w = quizWorld()
    const q = {
      ...makeQuestion(w.concept('SN1')),
      conceptId: null,
      conceptName: 'Hammond postulate',
    }
    const tagged = {
      ...makeQuestion(w.concept('SN1')),
      conceptId: null,
      conceptName: 'Organic Chemistry',
    }
    const quiz = saveQuiz(w.repos, 'exam', [q, tagged], [w.subject.id])
    w.quizzes.answer(quiz.id, q.id, 0)
    w.quizzes.answer(quiz.id, tagged.id, 0)
    await w.quizzes.finish(quiz.id)
    const created = w.repos.concepts.findByName(w.subject.id, 'Hammond postulate')
    expect(created).toMatchObject({ mastery: 0.3, box: 1 })
    expect(w.repos.concepts.findByName(w.subject.id, 'Organic Chemistry')).toBeNull()
    expect(w.quizzes.get(quiz.id).questions[0]?.conceptId).toBe(created?.id)
  })

  it('refuses to finish quizzes that are still generating', async () => {
    const w = quizWorld()
    const quiz = saveQuiz(w.repos, 'exam', [], [w.subject.id])
    w.repos.quizzes.save({ ...quiz, status: 'generating' })
    await expect(w.quizzes.finish(quiz.id)).rejects.toThrow(/generating/)
  })
})
