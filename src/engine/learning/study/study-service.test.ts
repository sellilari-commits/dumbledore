import type { CheckpointItem, LearnItem, Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import type { CheckpointInput, StepInput } from '../../brain-contract'
import {
  answerQuiz,
  chat,
  createHarness,
  flush,
  type Harness,
  ORGO_PLAN,
  seedEncounter,
  seedSubject,
} from './test-helpers'

function roadmapOf(h: Harness): Roadmap {
  const id = h.service.current()?.roadmapId
  const roadmap = id ? h.repos.roadmaps.get(id) : null
  if (!roadmap) throw new Error('no session roadmap')
  return roadmap
}

const checkpoint = (r: Roadmap, idx: number) => r.items[idx] as CheckpointItem
const learn = (r: Roadmap, idx: number) => r.items[idx] as LearnItem
const callsOf = <T>(h: Harness, method: string) =>
  h.brain.calls.filter((c) => c.method === method).map((c) => c.input as T)

function orgoHarness() {
  const h = createHarness({ brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) } })
  const subject = seedSubject(h.repos, 'Organic Chemistry', { emoji: '🧪' })
  seedEncounter(h.repos, subject.id, { openQuestions: ['Why are tertiary carbocations stable?'] })
  return { h, subject }
}

describe('StudyService — full session', () => {
  it('runs start → 2 steps → checkpoint with a miss → carried into checkpoint 2 → complete', async () => {
    const { h, subject } = orgoHarness()
    const s = h.service

    // Start: roadmap built from memory, step 1 written and handed over for pasting.
    const first = await s.start({ subjectId: subject.id, goal: null, question: null }, chat())
    const [roadmapInput] = callsOf<{
      subject: { name: string }
      assistant: string
      openQuestions: string[]
    }>(h, 'buildRoadmap')
    expect(roadmapInput?.subject.name).toBe('Organic Chemistry')
    expect(roadmapInput?.assistant).toBe('ChatGPT')
    expect(roadmapInput?.openQuestions).toContain('Why are tertiary carbocations stable?')
    let r = roadmapOf(h)
    expect(first).toMatchObject({ kind: 'paste', itemId: r.items[0]?.id })
    expect(first.kind === 'paste' && first.text.startsWith('DRAFT-1')).toBe(true)
    expect(learn(r, 0).promptSent).toBe(first.kind === 'paste' ? first.text : null)
    expect(r.items.map((i) => i.title)).toEqual([
      'Leaving groups',
      'Carbocation stability',
      'Checkpoint 1 · 3 questions',
      'SN1 mechanism',
      'Checkpoint 2 · 3 questions',
    ])
    expect(s.current()).toMatchObject({
      phase: 'step',
      index: 0,
      total: 5,
      nextAction: 'paste_next',
      subjectEmoji: '🧪',
    })

    // Step 2: step 1 done; checkpoint 1 is prefetched while the student reads step 2.
    const second = await s.next(
      chat({ chatExcerpt: 'AI: carbocations are stabilised by hyperconjugation' }),
    )
    r = roadmapOf(h)
    expect(second).toMatchObject({ kind: 'paste', itemId: r.items[1]?.id })
    expect(r.items[0]?.status).toBe('done')
    expect(s.current()).toMatchObject({ phase: 'step', index: 1, nextAction: 'open_quiz' })
    const [cp1Input] = callsOf<CheckpointInput>(h, 'makeCheckpoint')
    expect(cp1Input).toMatchObject({
      concepts: ['Leaving groups', 'Carbocation stability'],
      n: 3,
      carry: [],
    })
    expect(cp1Input?.studied).toContain('hyperconjugation')
    await flush()
    const prefetchedId = checkpoint(roadmapOf(h), 2).quizId
    expect(prefetchedId).not.toBeNull()

    // Checkpoint 1: the prefetched quiz is handed out; Next can't skip it. The shell asks
    // "quiz or continue?" first, so the engine doesn't open the card itself.
    const quiz1 = await s.next(chat())
    expect(quiz1).toEqual({ kind: 'quiz', quizId: prefetchedId, itemId: r.items[2]?.id })
    expect(h.quizOpens).toEqual([])
    expect(callsOf(h, 'makeCheckpoint')).toHaveLength(1)
    expect(s.current()).toMatchObject({ phase: 'checkpoint', index: 2, nextAction: 'open_quiz' })
    expect(await s.next(chat())).toEqual(quiz1)
    expect(roadmapOf(h).items[2]?.status).toBe('current')

    // One wrong answer on carbocation stability.
    const quizId = prefetchedId as string
    const result1 = answerQuiz(h, quizId, ['Carbocation stability'])
    s.handleCheckpointResult(quizId, result1)
    r = roadmapOf(h)
    expect(checkpoint(r, 2)).toMatchObject({ status: 'done', score: result1.score })
    expect(r.carry).toEqual(['Carbocation stability'])
    expect(checkpoint(r, 4)).toMatchObject({
      covers: ['SN1 mechanism', 'Carbocation stability'],
      nQuestions: 4,
      title: 'Checkpoint 2 · 4 questions',
    })
    expect(checkpoint(r, 4).probes).toContainEqual({
      concept: 'Carbocation stability',
      misconception: 'Thinks primary carbocations are the most stable',
    })
    expect(s.current()).toMatchObject({ phase: 'step', index: 3, nextAction: 'paste_next' })

    // Step 3 targets the miss; checkpoint 2 re-tests it with a new question.
    const third = await s.next(chat())
    expect(third).toMatchObject({ kind: 'paste', itemId: r.items[3]?.id })
    expect(third.kind === 'paste' && third.text).toContain(
      'Thinks primary carbocations are the most stable',
    )
    const stepInputs = callsOf<StepInput>(h, 'writeStep')
    expect(stepInputs.at(-1)?.recentMisses).toContainEqual({
      concept: 'Carbocation stability',
      misconception: 'Thinks primary carbocations are the most stable',
    })
    const cp2Input = callsOf<CheckpointInput>(h, 'makeCheckpoint')[1]
    expect(cp2Input).toMatchObject({ n: 4, carry: ['Carbocation stability'] })
    expect(cp2Input?.concepts).toEqual(['SN1 mechanism', 'Carbocation stability'])
    await flush()

    const quiz2 = await s.next(chat())
    expect(quiz2.kind).toBe('quiz')
    const quiz2Id = quiz2.kind === 'quiz' ? quiz2.quizId : ''
    const stored2 = h.repos.quizzes.get(quiz2Id)
    expect(stored2).toMatchObject({
      kind: 'checkpoint',
      roadmapId: r.id,
      roadmapItemId: r.items[4]?.id,
    })
    const carried = stored2?.questions.find((q) => q.conceptName === 'Carbocation stability')
    const missed = h.repos.quizzes
      .get(quizId)
      ?.questions.find((q) => q.conceptName === 'Carbocation stability')
    expect(carried?.carriedFrom).toBe(missed?.id)
    expect(carried?.conceptId).toBe(
      h.repos.concepts.findByName(r.subjectId, 'Carbocation stability')?.id,
    )

    // All correct → the carried concept is re-passed and the roadmap completes.
    s.handleCheckpointResult(quiz2Id, answerQuiz(h, quiz2Id, []))
    r = h.repos.roadmaps.get(r.id) as Roadmap
    expect(r.status).toBe('done')
    expect(r.carry).toEqual([])
    expect(h.completed).toEqual([r.id])
    expect(s.current()).toMatchObject({ phase: 'complete', nextAction: 'none' })
    const done = await s.next(chat())
    expect(done.kind).toBe('complete')
    expect(done.kind === 'complete' && done.summary).toContain('Roadmap complete: SN1 vs SN2')
    expect(h.completed).toHaveLength(1)
    expect(h.sessions.length).toBeGreaterThan(5)
  })

  it('touches the concepts of finished steps and applies memory updates from the chat', async () => {
    let call = 0
    const updates = createHarness({
      brain: {
        buildRoadmap: async () => structuredClone(ORGO_PLAN),
        writeStep: async (input) => {
          call++
          return {
            prompt: `${input.step.promptDraft} (adapted)`,
            coachTip: 'Tip',
            memoryUpdates:
              call === 2
                ? [
                    {
                      type: 'understanding',
                      concept: 'Leaving groups',
                      value: 'struggling',
                      evidence: 'Asked twice',
                    },
                    {
                      type: 'question',
                      concept: 'Leaving groups',
                      value: 'Why is iodide better than fluoride?',
                      evidence: '',
                    },
                  ]
                : [],
          }
        },
      },
    })
    const orgo = seedSubject(updates.repos, 'Organic Chemistry')
    await updates.service.start({ subjectId: orgo.id, goal: null, question: null }, chat())
    await updates.service.next(chat())
    const concept = updates.repos.concepts.findByName(orgo.id, 'Leaving groups')
    expect(concept).not.toBeNull()
    expect(updates.mastery.encounterCalls).toContainEqual({
      conceptId: concept?.id,
      understanding: 'unknown',
    })
    expect(updates.mastery.encounterCalls).toContainEqual({
      conceptId: concept?.id,
      understanding: 'struggling',
    })
    const [encounter] = updates.repos.encounters.list({ subjectId: orgo.id })
    expect(encounter).toMatchObject({
      conceptId: concept?.id,
      understanding: 'struggling',
      openQuestions: ['Why is iodide better than fluoride?'],
      inboxState: 'accepted',
      topicPath: ['Organic Chemistry', 'Leaving groups'],
    })
  })
})

describe('StudyService — "Continue" at a checkpoint', () => {
  it('skips the checkpoint, carries its concepts and hands out the next step', async () => {
    const { h, subject } = orgoHarness()
    const s = h.service
    await s.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await s.next(chat())
    await flush()
    const atCheckpoint = await s.next(chat())
    expect(atCheckpoint.kind).toBe('quiz')
    const cp1 = checkpoint(roadmapOf(h), 2)
    const next = await s.skipCheckpoint(cp1.id, chat())
    const r = roadmapOf(h)
    expect(next).toMatchObject({ kind: 'paste', itemId: r.items[3]?.id })
    expect(r.items[2]?.status).toBe('skipped')
    expect(r.carry).toEqual(expect.arrayContaining(cp1.covers))
    expect(checkpoint(r, 4).covers).toEqual(expect.arrayContaining(cp1.covers))
    expect(s.current()).toMatchObject({ phase: 'step', index: 3 })
    expect(h.quizOpens).toEqual([])
  })
})

describe('StudyService — resume and restart', () => {
  it('rebuilds the session from storage and reuses the prefetched checkpoint', async () => {
    const { h, subject } = orgoHarness()
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    await flush()
    const before = h.service.current()
    const prefetched = checkpoint(roadmapOf(h), 2).quizId

    const restarted = h.restart()
    expect(restarted.current()).toMatchObject({
      roadmapId: before?.roadmapId,
      index: 1,
      phase: 'step',
      nextAction: 'open_quiz',
      assistant: null,
    })
    const quiz = await restarted.next(chat())
    expect(quiz).toMatchObject({ kind: 'quiz', quizId: prefetched })
    expect(callsOf(h, 'makeCheckpoint')).toHaveLength(1)

    // Restart again while the checkpoint is open: same quiz, and its result still advances.
    const again = h.restart()
    expect(again.current()).toMatchObject({ phase: 'checkpoint', index: 2 })
    expect(await again.next(chat())).toEqual(quiz)
    again.handleCheckpointResult(prefetched as string, answerQuiz(h, prefetched as string))
    expect(again.current()).toMatchObject({ phase: 'step', index: 3, nextAction: 'paste_next' })
  })

  it('applies a finished quiz whose result never arrived (restart in between)', async () => {
    const { h, subject } = orgoHarness()
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const quiz = await h.service.next(chat())
    const quizId = quiz.kind === 'quiz' ? quiz.quizId : ''
    answerQuiz(h, quizId, ['Leaving groups'])

    const restarted = h.restart()
    const next = await restarted.next(chat())
    const r = h.repos.roadmaps.get(roadmapOf(h).id) as Roadmap
    expect(checkpoint(r, 2).status).toBe('done')
    expect(r.carry).toEqual(['Leaving groups'])
    expect(next).toMatchObject({ kind: 'paste', itemId: r.items[3]?.id })
  })

  it('end() parks the roadmap; start(subject) resumes it at the current step', async () => {
    const { h, subject } = orgoHarness()
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const id = roadmapOf(h).id
    h.service.end()
    expect(h.service.current()).toBeNull()
    expect(h.repos.roadmaps.get(id)?.status).toBe('paused')
    expect(h.restart().current()).toBeNull()
    expect(h.service.picker().subjects[0]).toMatchObject({ hasActiveRoadmap: true })

    const resumed = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    const r = h.repos.roadmaps.get(id) as Roadmap
    expect(resumed).toMatchObject({ kind: 'paste', itemId: r.items[1]?.id })
    expect(r.status).toBe('active')
    expect(callsOf(h, 'buildRoadmap')).toHaveLength(1)
  })

  it('pause() keeps the session visible; next() resumes by re-delivering the current step', async () => {
    const { h, subject } = orgoHarness()
    const first = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    h.service.pause()
    expect(h.service.current()).toMatchObject({ phase: 'paused', nextAction: 'none' })
    expect(roadmapOf(h).status).toBe('paused')
    const again = await h.service.next(chat())
    expect(again).toMatchObject({
      kind: 'paste',
      itemId: first.kind === 'paste' ? first.itemId : '',
    })
    expect(h.service.current()).toMatchObject({ phase: 'step', index: 0 })
    expect(roadmapOf(h).status).toBe('active')
  })

  it('a new goal for the same subject plans a new roadmap and parks the old one', async () => {
    const { h, subject } = orgoHarness()
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await h.service.next(chat())
    const oldId = roadmapOf(h).id
    h.clock.advance(60_000)
    const question = 'Why are tertiary carbocations stable?'
    await h.service.start({ subjectId: subject.id, goal: null, question }, chat())
    const newId = roadmapOf(h).id
    expect(newId).not.toBe(oldId)
    expect(h.repos.roadmaps.get(oldId)?.status).toBe('paused')
    expect(h.repos.roadmaps.getActive(subject.id)?.id).toBe(newId)
    const second = callsOf<{ openQuestions: string[]; doneSteps: string[] }>(h, 'buildRoadmap')[1]
    expect(second?.openQuestions[0]).toBe(question)
    expect(second?.doneSteps).toEqual(['Leaving groups'])

    // Picking the subject again (no goal) resumes the new roadmap, not the parked one.
    h.service.end()
    const resumed = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    expect(roadmapOf(h).id).toBe(newId)
    expect(resumed).toMatchObject({ kind: 'paste', itemId: roadmapOf(h).items[0]?.id })
  })
})
