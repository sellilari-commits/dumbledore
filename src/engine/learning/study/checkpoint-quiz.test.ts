import type { CheckpointItem, Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import type { CheckpointInput, QuestionDraft, VerifyResult } from '../../brain-contract'
import { FakeClock } from '../../clock'
import { FakeBrain } from '../../testing/fake-brain'
import { createMemoryRepos } from '../../testing/memory-repos'
import { buildCheckpointQuiz } from './checkpoint-quiz'
import { materializeRoadmap } from './materialize'
import {
  answerQuiz,
  chat,
  createHarness,
  deferred,
  flush,
  ORGO_PLAN,
  seedSubject,
} from './test-helpers'

const OPTS = { checkpointTimeoutMs: 25_000, verifyTimeoutMs: 15_000, maxRegenerateTries: 2 }

function fixture(brain: FakeBrain) {
  const clock = new FakeClock()
  const repos = createMemoryRepos(clock)
  const subject = repos.subjects.create({ name: 'Organic Chemistry' })
  const roadmap = materializeRoadmap({
    id: 'rdm_test',
    subjectId: subject.id,
    plan: structuredClone(ORGO_PLAN),
    carry: [],
    noHistory: false,
    nowIso: clock.nowIso(),
  })
  repos.roadmaps.save(roadmap)
  const item = roadmap.items[2] as CheckpointItem
  const build = () =>
    buildCheckpointQuiz(
      { repos, brain, clock },
      {
        roadmap,
        item,
        studied: 'AI explained leaving groups and carbocations',
        language: 'auto',
        nowIso: clock.nowIso(),
      },
      OPTS,
    )
  return { repos, roadmap, item, build }
}

const checkpointCalls = (brain: FakeBrain) =>
  brain.calls.filter((c) => c.method === 'makeCheckpoint').map((c) => c.input as CheckpointInput)
const verifyCalls = (brain: FakeBrain) => brain.calls.filter((c) => c.method === 'verifyQuestions')

/** Verifier that disputes the key of every question on `concept` (optionally only `times` times). */
function disputing(concept: string, times = Number.POSITIVE_INFINITY) {
  let disputes = 0
  return async (questions: QuestionDraft[]): Promise<VerifyResult[]> =>
    questions.map((q, index) => {
      const dispute = q.concept === concept && disputes < times
      if (dispute) disputes++
      return { index, chosen: dispute ? (q.correctIndex + 1) % 4 : q.correctIndex, confidence: 0.8 }
    })
}

describe('checkpoint quiz generation', () => {
  it('asks the quizmaster for covers + carry with the item probes and n', async () => {
    const brain = new FakeBrain()
    const { build, roadmap, item } = fixture(brain)
    const quiz = await build()
    expect(checkpointCalls(brain)[0]).toMatchObject({
      concepts: ['Leaving groups', 'Carbocation stability'],
      probes: [
        {
          concept: 'Carbocation stability',
          misconception: 'Primary carbocations are the most stable',
        },
      ],
      carry: [],
      n: 3,
      studied: 'AI explained leaving groups and carbocations',
    })
    expect(quiz).toMatchObject({
      kind: 'checkpoint',
      title: 'Checkpoint 1 · SN1 vs SN2',
      roadmapId: roadmap.id,
      roadmapItemId: item.id,
      status: 'ready',
      answers: [],
    })
    expect(quiz.questions).toHaveLength(3)
    expect(quiz.questions.every((q) => q.conceptId !== null && q.carriedFrom === null)).toBe(true)
  })

  it('regenerates a question whose key the verifier disputes', async () => {
    const brain = new FakeBrain({ verifyQuestions: disputing('Carbocation stability', 1) })
    const { build } = fixture(brain)
    const quiz = await build()
    const calls = checkpointCalls(brain)
    expect(calls).toHaveLength(2)
    expect(calls[1]).toMatchObject({
      concepts: ['Carbocation stability'],
      n: 1,
      probes: [
        {
          concept: 'Carbocation stability',
          misconception: 'Primary carbocations are the most stable',
        },
      ],
    })
    expect(verifyCalls(brain)).toHaveLength(2)
    expect(quiz.questions.map((q) => q.conceptName)).toEqual([
      'Leaving groups',
      'Carbocation stability',
      'Leaving groups',
    ])
    // FakeBrain's first draft for a concept has key 0; the disputed original (slot 1) had key 1.
    expect(quiz.questions[1]?.correctIndex).toBe(0)
  })

  it('drops a question that still mismatches after 2 regenerations', async () => {
    const brain = new FakeBrain({ verifyQuestions: disputing('Carbocation stability') })
    const { build } = fixture(brain)
    const quiz = await build()
    expect(checkpointCalls(brain)).toHaveLength(3)
    expect(verifyCalls(brain)).toHaveLength(3)
    expect(quiz.questions.map((q) => q.conceptName)).toEqual(['Leaving groups', 'Leaving groups'])
  })

  it('keeps questions unverified when the verifier is down, and fails when nothing survives', async () => {
    const down = new FakeBrain({ verifyQuestions: async () => Promise.reject(new Error('503')) })
    expect((await fixture(down).build()).questions).toHaveLength(3)

    const hostile = new FakeBrain({
      verifyQuestions: async (qs) =>
        qs.map((q, index) => ({ index, chosen: (q.correctIndex + 1) % 4, confidence: 1 })),
    })
    await expect(fixture(hostile).build()).rejects.toThrow(
      /no checkpoint question passed verification/,
    )
  })

  it('filters malformed drafts', async () => {
    const brain = new FakeBrain({
      makeCheckpoint: async (input) =>
        [
          {
            concept: 'Leaving groups',
            stem: 'Broken',
            options: ['a', 'b', 'c'],
            correctIndex: 0,
            rationales: ['a', 'b', 'c'],
            difficulty: 2,
          },
          {
            concept: input.concepts[0] ?? 'x',
            stem: 'Which is right?',
            options: ['a', 'b', 'c', 'd'],
            correctIndex: 2,
            rationales: ['1', '2', '3', '4'],
            difficulty: 2,
          },
        ] as QuestionDraft[],
    })
    const quiz = await fixture(brain).build()
    expect(quiz.questions.map((q) => q.stem)).toEqual(['Which is right?'])
  })
})

describe('StudyService — checkpoints in the session', () => {
  function orgo(brain: ConstructorParameters<typeof FakeBrain>[0] = {}) {
    const h = createHarness({
      brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN), ...brain },
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    return { h, subject }
  }
  const roadmapOf = (h: ReturnType<typeof createHarness>) =>
    h.repos.roadmaps.get(h.service.current()?.roadmapId ?? '') as Roadmap

  it('joins the in-flight prefetch instead of generating twice', async () => {
    const slow = deferred<QuestionDraft[]>()
    const fake = new FakeBrain()
    const { h, subject } = orgo({
      makeCheckpoint: (input) => slow.promise.then(() => fake.makeCheckpoint(input)),
    })
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const quizPromise = h.service.next(chat())
    await flush()
    expect(h.service.current()?.items[2]?.status).toBe('current')
    slow.resolve([])
    const quiz = await quizPromise
    expect(quiz.kind).toBe('quiz')
    expect(h.brain.calls.filter((c) => c.method === 'makeCheckpoint')).toHaveLength(1)
    expect((roadmapOf(h).items[2] as CheckpointItem).quizId).toBe(
      quiz.kind === 'quiz' ? quiz.quizId : null,
    )
  })

  it('reports a failed quiz as a retryable error, then skips the checkpoint on the next failure', async () => {
    const { h, subject } = orgo({
      makeCheckpoint: async () => Promise.reject(new Error('rate limited')),
    })
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    await flush()
    await expect(h.service.next(chat())).rejects.toThrow(
      /Couldn't prepare the checkpoint quiz \(rate limited\)/,
    )
    expect(h.service.current()).toMatchObject({ phase: 'error', index: 2, nextAction: 'open_quiz' })
    expect(h.service.current()?.error).toMatch(/Press Next to try again/)

    const next = await h.service.next(chat())
    const r = roadmapOf(h)
    expect(r.items[2]?.status).toBe('skipped')
    expect(next).toMatchObject({ kind: 'paste', itemId: r.items[3]?.id })
    expect(h.service.current()).toMatchObject({ phase: 'step', index: 3, error: null })
  })

  it('with a live chat feed, prefetches after the delay using what the AI answered', async () => {
    let live = 'AI: (still typing)'
    const h = createHarness({
      brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) },
      chatExcerpt: () => live,
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat({ chatExcerpt: 'old excerpt' }))
    const makes = () => h.brain.calls.filter((c) => c.method === 'makeCheckpoint')
    expect(makes()).toHaveLength(0)
    live = 'AI: tertiary carbocations are most stable because of hyperconjugation'
    h.clock.advance(20_000)
    await flush()
    expect(makes()).toHaveLength(1)
    expect((makes()[0]?.input as CheckpointInput | undefined)?.studied).toContain(
      'hyperconjugation',
    )
    const quiz = await h.service.next(chat())
    expect(quiz).toMatchObject({
      kind: 'quiz',
      quizId: (roadmapOf(h).items[2] as CheckpointItem).quizId,
    })
    expect(makes()).toHaveLength(1)
  })

  it('pressing Next before the delayed prefetch generates on demand, once', async () => {
    const h = createHarness({
      brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) },
      chatExcerpt: () => 'live text',
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const quiz = await h.service.next(chat({ chatExcerpt: 'fresh excerpt from Next' }))
    expect(quiz.kind).toBe('quiz')
    h.clock.advance(60_000)
    await flush()
    const makes = h.brain.calls.filter((c) => c.method === 'makeCheckpoint')
    expect(makes).toHaveLength(1)
    expect((makes[0]?.input as CheckpointInput | undefined)?.studied).toBe(
      'fresh excerpt from Next',
    )
    expect(h.clock.pendingTimers()).toBe(0)
  })

  it('end() while the quiz is being generated does not open it', async () => {
    const slow = deferred<QuestionDraft[]>()
    const fake = new FakeBrain()
    const { h, subject } = orgo({
      makeCheckpoint: (input) => slow.promise.then(() => fake.makeCheckpoint(input)),
    })
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const pending = h.service.next(chat())
    await flush()
    h.service.end()
    slow.resolve([])
    expect(await pending).toEqual({ kind: 'wait', reason: 'The study session ended.' })
    expect(h.quizOpens).toEqual([])
    expect(h.service.current()).toBeNull()
  })

  it('accepts a checkpoint taken early from the side stack', async () => {
    const { h, subject } = orgo()
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    await flush()
    const quizId = (roadmapOf(h).items[2] as CheckpointItem).quizId as string
    h.service.handleCheckpointResult(quizId, answerQuiz(h, quizId, ['Leaving groups']))
    const r = roadmapOf(h)
    expect(r.items.slice(0, 3).map((i) => i.status)).toEqual(['done', 'done', 'done'])
    expect(r.carry).toEqual(['Leaving groups'])
    expect(h.service.current()).toMatchObject({ phase: 'step', index: 3, nextAction: 'paste_next' })
    // A duplicate result is ignored.
    h.service.handleCheckpointResult(quizId, answerQuiz(h, quizId, []))
    expect(roadmapOf(h).carry).toEqual(['Leaving groups'])
  })
})
