/**
 * Test fixtures for lane L5 (quizzes, follow-ups): a wired QuizService over in-memory repos,
 * FakeBrain and FakeClock, plus builders for concepts, questions and quizzes. Test-only.
 */
import type { Brain, QuestionDraft } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import { createEngineBus, type EngineEvents } from '@engine/events'
import { newId } from '@engine/ids'
import { createMasteryModel } from '@engine/learning/mastery/mastery-model'
import { fixedOffsetLocalTime } from '@engine/scheduler/local-time'
import { type BrainOverrides, FakeBrain } from '@engine/testing/fake-brain'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { Concept, Id, Question, Quiz, QuizKind } from '@shared/domain'
import { type CheckpointHandler, createQuizService } from './quiz-service'

export const silentLog = (): void => {}

/**
 * FakeBrain whose generated questions get unique stems. The stock fake repeats the same stem for
 * a concept, which the quiz de-duplication (rightly) drops.
 */
export function variedBrain(overrides: BrainOverrides = {}): FakeBrain {
  const base = new FakeBrain()
  let n = 0
  const vary = (qs: QuestionDraft[]) => qs.map((q) => ({ ...q, stem: `${q.stem} (#${++n})` }))
  return new FakeBrain({
    makeExam: async (input, opts) => vary(await base.makeExam(input, opts)),
    makeCheckpoint: async (input, opts) => vary(await base.makeCheckpoint(input, opts)),
    ...overrides,
  })
}

export function quizWorld(
  opts: { brain?: Brain; start?: string; onCheckpoint?: CheckpointHandler } = {},
) {
  const clock = new FakeClock(opts.start ?? '2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const bus = createEngineBus()
  const brain = opts.brain ?? variedBrain()
  const localTime = fixedOffsetLocalTime(0)
  const mastery = createMasteryModel({ repos, localTime })
  const quizzes = createQuizService({
    repos,
    brain,
    bus,
    clock,
    mastery,
    localTime,
    onCheckpointFinished: opts.onCheckpoint,
    log: silentLog,
  })
  const events: { name: keyof EngineEvents; payload: unknown }[] = []
  for (const name of ['memory:changed', 'nudge:ready', 'toast:show', 'quiz:open'] as const) {
    bus.on(name, (payload) => events.push({ name, payload }))
  }
  const subject = repos.subjects.create({ name: 'Organic Chemistry', emoji: '🧪' })
  const concept = (name: string, patch: Partial<Concept> = {}): Concept => {
    const c = repos.concepts.upsert({ subjectId: patch.subjectId ?? subject.id, name })
    return Object.keys(patch).length > 0 ? repos.concepts.update(c.id, patch) : c
  }
  return { clock, repos, bus, brain, mastery, quizzes, events, subject, concept, localTime }
}

export function makeQuestion(concept: Concept, correctIndex = 0, difficulty = 2): Question {
  return {
    id: newId('qst'),
    conceptName: concept.name,
    conceptId: concept.id,
    stem: `What is true about ${concept.name}? (${newId('tst')})`,
    options: ['Option A', 'Option B', 'Option C', 'Option D'],
    correctIndex,
    rationales: [
      'Because A.',
      'B mixes up cause and effect.',
      'C ignores the rate law.',
      'D is the reverse.',
    ],
    difficulty,
    carriedFrom: null,
  }
}

export function saveQuiz(
  repos: ReturnType<typeof quizWorld>['repos'],
  kind: QuizKind,
  questions: Question[],
  subjectIds: Id[],
  createdAt = '2026-10-24T09:00:00.000Z',
): Quiz {
  const quiz: Quiz = {
    id: newId('quz'),
    kind,
    title: `${kind} quiz`,
    subjectIds,
    roadmapId: kind === 'checkpoint' ? 'rdm_test' : null,
    roadmapItemId: kind === 'checkpoint' ? 'itm_test' : null,
    status: 'ready',
    questions,
    answers: [],
    score: null,
    createdAt,
    completedAt: null,
  }
  repos.quizzes.save(quiz)
  return quiz
}
