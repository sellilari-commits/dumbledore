/**
 * Test fixtures for the study lane: a tiny MasteryModel stand-in (lane L5 builds the real one),
 * a wired StudyService on FakeClock + FakeBrain + memory repos, and a quiz-card simulator that
 * answers a checkpoint and returns the QuizResult lane L5's QuizService would produce.
 */
import type {
  Concept,
  Id,
  MasteryStatus,
  QuizResult,
  Subject,
  UnderstandingStatus,
} from '@shared/domain'
import type { SessionState } from '@shared/state'
import type { RoadmapPlan } from '../../brain-contract'
import { FakeClock } from '../../clock'
import type { ChatContext, MasteryModel, Repos } from '../../contracts'
import { createEngineBus, type EngineBus, type EngineEvents } from '../../events'
import { type BrainOverrides, FakeBrain } from '../../testing/fake-brain'
import { createMemoryRepos } from '../../testing/memory-repos'
import type { StudyOptions } from './deps'
import { StudyServiceImpl } from './study-service'
import { norm } from './text'

export class FakeMastery implements MasteryModel {
  readonly encounterCalls: { conceptId: Id; understanding: UnderstandingStatus }[] = []
  readonly answerCalls: { conceptId: Id; correct: boolean }[] = []

  constructor(private readonly repos: Repos) {}

  applyAnswer(conceptId: Id, correct: boolean, _difficulty: number, atIso: string): Concept {
    this.answerCalls.push({ conceptId, correct })
    const c = this.must(conceptId)
    const mastery = correct ? c.mastery + (1 - c.mastery) * 0.3 : c.mastery * 0.6
    return this.repos.concepts.update(conceptId, {
      mastery,
      lastSeenAt: atIso,
      status: correct ? statusOf(mastery) : 'struggling',
    })
  }

  applyEncounter(conceptId: Id, understanding: UnderstandingStatus, atIso: string): Concept {
    this.encounterCalls.push({ conceptId, understanding })
    const c = this.must(conceptId)
    const struggling = understanding === 'struggling'
    return this.repos.concepts.update(conceptId, {
      mastery: struggling ? c.mastery * 0.9 : Math.min(1, c.mastery + 0.05),
      lastSeenAt: atIso,
      status: struggling ? 'struggling' : c.status,
      struggleCount: c.struggleCount + (struggling ? 1 : 0),
    })
  }

  private must(id: Id): Concept {
    const c = this.repos.concepts.get(id)
    if (!c) throw new Error(`concept ${id} not found`)
    return c
  }
}

const statusOf = (m: number): MasteryStatus =>
  m >= 0.85 ? 'mastered' : m >= 0.2 ? 'learning' : 'new'

export const BREVITY = 'No greetings or small talk. Short structured bullets, max ~150 words.'

/** A roadmap whose second checkpoint does not cover the first one's concepts. */
export const ORGO_PLAN: RoadmapPlan = {
  title: 'SN1 vs SN2',
  goal: 'Tell SN1 from SN2 reactions',
  startReason: 'You know nucleophiles already; we start with leaving groups.',
  offerPlacement: false,
  estimatedMinutes: 30,
  items: [
    {
      kind: 'learn',
      title: 'Leaving groups',
      objective: 'Can explain what makes a good leaving group',
      concepts: ['Leaving groups'],
      move: 'intuition',
      promptDraft: `DRAFT-1 I'm studying SN1 vs SN2. Explain leaving groups in 3 points. ${BREVITY}`,
    },
    {
      kind: 'learn',
      title: 'Carbocation stability',
      objective: 'Can rank carbocations by stability',
      concepts: ['Carbocation stability'],
      move: 'worked_example',
      promptDraft: `DRAFT-2 Walk me through ranking carbocations. ${BREVITY}`,
    },
    {
      kind: 'checkpoint',
      covers: ['Leaving groups', 'Carbocation stability'],
      probes: [
        {
          concept: 'Carbocation stability',
          misconception: 'Primary carbocations are the most stable',
        },
      ],
      nQuestions: 3,
    },
    {
      kind: 'learn',
      title: 'SN1 mechanism',
      objective: 'Can explain the SN1 steps',
      concepts: ['SN1 mechanism'],
      move: 'explain_back',
      promptDraft: `DRAFT-3 Let me explain SN1 back to you. ${BREVITY}`,
    },
    { kind: 'checkpoint', covers: ['SN1 mechanism'], probes: [], nQuestions: 3 },
  ],
  nextMilestone: null,
}

export interface Harness {
  clock: FakeClock
  repos: Repos
  brain: FakeBrain
  bus: EngineBus
  mastery: FakeMastery
  completed: Id[]
  sessions: (SessionState | null)[]
  quizOpens: Id[]
  service: StudyServiceImpl
  /** A fresh service on the same storage, as after an app restart. */
  restart(): StudyServiceImpl
}

export interface HarnessOptions {
  brain?: BrainOverrides
  options?: Partial<StudyOptions>
  /** Live chat feed (PerceptionService.chatExcerpt stand-in). */
  chatExcerpt?: (maxChars: number) => string
}

export function createHarness(opts: HarnessOptions = {}): Harness {
  const clock = new FakeClock('2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const brain = new FakeBrain(opts.brain)
  const bus = createEngineBus()
  const mastery = new FakeMastery(repos)
  const completed: Id[] = []
  const sessions: (SessionState | null)[] = []
  const quizOpens: Id[] = []
  bus.on('session:changed', ({ session }: EngineEvents['session:changed']) =>
    sessions.push(session),
  )
  bus.on('quiz:open', ({ quizId }) => quizOpens.push(quizId))
  const make = () =>
    new StudyServiceImpl({
      repos,
      brain,
      clock,
      bus,
      mastery,
      followUp: { onSessionComplete: (id) => completed.push(id) },
      chatExcerpt: opts.chatExcerpt ?? null,
      options: opts.options,
    })
  return {
    clock,
    repos,
    brain,
    bus,
    mastery,
    completed,
    sessions,
    quizOpens,
    service: make(),
    restart: make,
  }
}

export const chat = (over: Partial<ChatContext> = {}): ChatContext => ({
  assistant: 'ChatGPT',
  chatExcerpt: '[R] what is a leaving group\n[L] A leaving group departs with the electron pair…',
  pageContext: '',
  ...over,
})

/** Lets pending promise chains (prefetches, background saves) settle. */
export const flush = async (): Promise<void> => {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

export function seedSubject(repos: Repos, name: string, patch: Partial<Subject> = {}): Subject {
  const subject = repos.subjects.create({ name })
  return Object.keys(patch).length > 0 ? repos.subjects.update(subject.id, patch) : subject
}

export function seedEncounter(
  repos: Repos,
  subjectId: Id | null,
  over: {
    openQuestions?: string[]
    keyTerms?: string[]
    seen?: string
    understanding?: UnderstandingStatus
  } = {},
) {
  return repos.encounters.add({
    subjectId,
    conceptId: null,
    episodeId: null,
    seen: over.seen ?? 'Rate = k[R–X]; tertiary substrates favour SN1.',
    bigPicture: 'Organic Chemistry › Substitution — when each mechanism happens.',
    topicPath: ['Organic Chemistry', 'Substitution'],
    understanding: over.understanding ?? 'unknown',
    evidence: '',
    openQuestions: over.openQuestions ?? [],
    keyTerms: over.keyTerms ?? [],
    source: {
      app: 'Google Chrome',
      bundleId: 'com.google.Chrome',
      url: null,
      title: 'SN1 reaction',
    },
    dwellSeconds: 120,
  })
}

/**
 * Answers every question of a quiz (wrong for `wrongConcepts`), marks it done and returns the
 * QuizResult lane L5's QuizService would hand to `handleCheckpointResult`.
 */
export function answerQuiz(
  h: Pick<Harness, 'repos' | 'clock'>,
  quizId: Id,
  wrongConcepts: string[] = [],
  misconception = 'Thinks primary carbocations are the most stable',
): QuizResult {
  const quiz = h.repos.quizzes.get(quizId)
  if (!quiz) throw new Error(`quiz ${quizId} not found`)
  const wrong = new Set(wrongConcepts.map(norm))
  const byConcept = new Map<string, { conceptName: string; correct: number; total: number }>()
  for (const q of quiz.questions) {
    const miss = wrong.has(norm(q.conceptName))
    h.repos.quizzes.recordAnswer(quizId, {
      questionId: q.id,
      chosenIndex: miss ? (q.correctIndex + 1) % 4 : q.correctIndex,
      correct: !miss,
      answeredAt: h.clock.nowIso(),
    })
    const row = byConcept.get(q.conceptName) ?? { conceptName: q.conceptName, correct: 0, total: 0 }
    row.total++
    if (!miss) row.correct++
    byConcept.set(q.conceptName, row)
  }
  const correct = quiz.questions.filter((q) => !wrong.has(norm(q.conceptName))).length
  const score = correct / quiz.questions.length
  const answered = h.repos.quizzes.get(quizId)
  if (answered)
    h.repos.quizzes.save({ ...answered, status: 'done', score, completedAt: h.clock.nowIso() })
  return {
    quizId,
    score,
    correct,
    total: quiz.questions.length,
    byConcept: [...byConcept.values()].map((r) => ({
      ...r,
      status: r.correct === r.total ? 'learning' : 'struggling',
    })),
    gaps: wrongConcepts.map((concept) => ({ concept, misconception })),
    fixPrompt: null,
    nextTopic: null,
  }
}

/** A promise you resolve or reject from the test. */
export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}
