import type { CheckpointInput, ExamInput, QuestionDraft } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { BackendError } from './llm/types'
import { shuffleQuestion } from './prompts/p05-quiz'
import { planExam } from './prompts/p06-exam'
import { brainHarness, R } from './testing/harness'

const q = (concept: string, i: number, over: Partial<QuestionDraft> = {}): QuestionDraft => ({
  concept,
  stem: `Question ${i} about ${concept}: what happens when the substrate is tertiary?`,
  options: [`Right answer ${i}`, `Wrong idea A ${i}`, `Wrong idea B ${i}`, `Wrong idea C ${i}`],
  correctIndex: 0,
  rationales: ['Correct because…', 'Confuses…', 'Reverses…', 'Ignores…'],
  difficulty: 2,
  ...over,
})

const checkpointInput = (over: Partial<CheckpointInput> = {}): CheckpointInput => ({
  concepts: ['Carbocation stability', 'SN1 mechanism'],
  probes: [
    { concept: 'Carbocation stability', misconception: 'Primary carbocations are most stable' },
  ],
  carry: ['Leaving groups'],
  n: 3,
  studied: '[L] Tertiary carbocations are stabilised by hyperconjugation and induction…',
  language: 'en',
  ...over,
})

describe('Brain.makeCheckpoint', () => {
  it('maps concepts, probes, carry and studied text; returns n shuffled questions', async () => {
    const h = brainHarness()
    h.groq.queue({ json: { questions: [q('A', 1), q('B', 2), q('C', 3), q('D', 4)] } })
    const out = await h.brain.makeCheckpoint(checkpointInput())
    const user = h.userOf(h.groq)
    expect(user).toContain('Carbocation stability: Primary carbocations are most stable')
    expect(user).toContain('<carry>\n- Leaving groups')
    expect(user).toContain('hyperconjugation')
    expect(h.groq.requests[0]?.system).toContain('Write exactly 3 questions in English')
    expect(out).toHaveLength(3)
    for (const [i, question] of out.entries()) {
      expect(question.options[question.correctIndex]).toBe(`Right answer ${i + 1}`)
      expect(question.rationales[question.correctIndex]).toBe('Correct because…')
    }
  })

  it('asks for a rewrite of "all of the above" options', async () => {
    const h = brainHarness()
    const bad = q('A', 1, { options: ['x', 'y', 'z', 'All of the above'] })
    h.groq.queue(
      { json: { questions: [bad, q('B', 2), q('C', 3)] } },
      { json: { questions: [q('A', 1), q('B', 2), q('C', 3)] } },
    )
    const out = await h.brain.makeCheckpoint(checkpointInput())
    expect(h.groq.requests[1]?.messages.at(-1)?.content).toMatch(/all\/none of the above/)
    expect(out.flatMap((x) => x.options)).not.toContain('All of the above')
  })

  it('repairs malformed questions (3 options)', async () => {
    const h = brainHarness()
    const broken = { ...q('A', 1), options: ['a', 'b', 'c'] }
    h.groq.queue(
      { json: { questions: [broken] } },
      { json: { questions: [q('A', 1), q('B', 2), q('C', 3)] } },
    )
    const out = await h.brain.makeCheckpoint(checkpointInput())
    expect(out).toHaveLength(3)
    expect(h.groq.requests[1]?.messages.at(-1)?.content).toContain('questions.0.options')
  })
})

describe('shuffleQuestion', () => {
  it('keeps the key attached to its option and sorts numeric options', () => {
    const s = shuffleQuestion(q('A', 7))
    expect(s.options[s.correctIndex]).toBe('Right answer 7')
    const numeric = shuffleQuestion(
      q('N', 1, { options: ['40', '10', '30', '20'], correctIndex: 2 }),
    )
    expect(numeric.options).toEqual(['10', '20', '30', '40'])
    expect(numeric.options[numeric.correctIndex]).toBe('30')
  })
})

describe('Brain.verifyQuestions', () => {
  it('answers blind: no key or rationales in the prompt, batches of 10 with offsets', async () => {
    const h = brainHarness([R.groq])
    const qs = Array.from({ length: 12 }, (_, i) =>
      q('A', i, { rationales: ['SECRET', 'SECRET', 'SECRET', 'SECRET'] }),
    )
    h.groq.fallback = (req) => {
      const n = (req.messages[0]?.content.match(/^Q\d+/gm) ?? []).length
      return {
        json: {
          answers: Array.from({ length: n }, (_, index) => ({ index, chosen: 0, confidence: 0.9 })),
        },
      }
    }
    const out = await h.brain.verifyQuestions(qs)
    expect(h.groq.requests).toHaveLength(2)
    const user = h.userOf(h.groq)
    expect(user).not.toContain('SECRET')
    expect(user).not.toContain('correctIndex')
    expect(user).toContain('A) Right answer 0')
    expect(out.map((r) => r.index)).toEqual(qs.map((_, i) => i))
    expect(h.groq.requests[0]?.temperature).toBe(0)
  })

  it('does not use the on-device model', async () => {
    const h = brainHarness([R.apple, R.ovh])
    h.ovh.queue({ json: { answers: [{ index: 0, chosen: 1, confidence: 0.4 }] } })
    const out = await h.brain.verifyQuestions([q('A', 1)])
    expect(h.apple.requests).toHaveLength(0)
    expect(out).toEqual([{ index: 0, chosen: 1, confidence: 0.4 }])
  })
})

const examInput = (count: 5 | 10 | 20, over: Partial<ExamInput> = {}): ExamInput => ({
  subjects: [{ id: 's1', name: 'Organic Chemistry' }],
  spec: { subjectIds: ['s1'], count, focus: 'weak', difficulty: 'mixed' },
  concepts: [
    { name: 'SN2', status: 'mastered', mastery: 0.9 },
    { name: 'Carbocations', status: 'struggling', mastery: 0.2 },
    { name: 'Leaving groups', status: 'learning', mastery: 0.5 },
    { name: 'E1', status: 'new', mastery: 0 },
  ],
  encounters: [{ seen: 'Rate = k[R–X]', bigPicture: 'SN1 kinetics' }],
  language: 'en',
  ...over,
})

describe('Brain.makeExam', () => {
  it('plans weak spots first, in batches of 5 with a difficulty ramp', () => {
    const batches = planExam(examInput(20))
    expect(batches).toHaveLength(4)
    expect(batches[0]?.plan[0]?.concept).toBe('Carbocations')
    expect(batches.flatMap((b) => b.plan).some((p) => p.concept === 'SN2')).toBe(false)
    expect(batches.map((b) => b.difficulty)).toEqual(['easy', 'medium', 'medium', 'hard'])
  })

  it('generates batches in sequence and passes earlier stems to avoid', async () => {
    const h = brainHarness()
    let n = 0
    h.groq.fallback = () => ({ json: { questions: Array.from({ length: 5 }, () => q('C', ++n)) } })
    const out = await h.brain.makeExam(examInput(10))
    expect(out).toHaveLength(10)
    expect(h.groq.requests).toHaveLength(2)
    expect(h.userOf(h.groq, 1)).toContain('Question 1 about C')
    expect(h.groq.requests[1]?.system).toContain('Never repeat or reword a question from <avoid>')
  })

  it('returns a partial exam when a later batch fails', async () => {
    const h = brainHarness()
    h.groq.queue(
      { json: { questions: Array.from({ length: 5 }, (_, i) => q('C', i)) } },
      { error: new BackendError('bad_request', 'nope') },
    )
    const out = await h.brain.makeExam(examInput(10))
    expect(out).toHaveLength(5)
  })
})
