/**
 * QuizService (engine/contracts.ts): taking quizzes, finishing them (score, mastery updates,
 * gaps via the gap fixer with a template fallback, checkpoint hand-off to lane L4), exams
 * generated in the background, and review quizzes over due concepts.
 */
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { MasteryModel, QuizService, Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { newId } from '@engine/ids'
import { createMasteryModel } from '@engine/learning/mastery/mastery-model'
import type { LocalTime } from '@engine/scheduler/local-time'
import {
  type AnswerResult,
  ExamSpec,
  type Id,
  type MasteryStatus,
  type Question,
  type Quiz,
  type QuizResult,
} from '@shared/domain'
import type { MemoryScope } from '@shared/state'
import { defaultLog, type Log, normalize } from './drafts'
import { examTitle, generateExamQuestions } from './exam-builder'
import {
  answeredInOrder,
  breakdown,
  fallbackGaps,
  gapInput,
  missesOf,
  scoreQuiz,
} from './quiz-results'
import { generateReviewQuestions, pickReviewConcepts, reviewTitle } from './review-builder'

export type CheckpointHandler = (quizId: Id, result: QuizResult) => void | Promise<void>

export interface QuizServiceDeps {
  repos: Repos
  brain: Brain
  bus: EngineBus
  clock: Clock
  mastery?: MasteryModel
  localTime?: LocalTime
  /** Lane L4: called after a checkpoint quiz is finished (score, carry-over, advance). */
  onCheckpointFinished?: CheckpointHandler
  /** Name of the student's AI assistant for repair prompts ("ChatGPT" when unknown). */
  assistantName?: () => string | null
  log?: Log
}

export interface QuizServiceImpl extends QuizService {
  setCheckpointHandler(handler: CheckpointHandler | null): void
  /** Resolves once background exam generation has finished (tests, shutdown). */
  settled(): Promise<void>
  /** Marks exams a previous run left in 'generating' as failed. Call once at startup. */
  recoverInterrupted(): Id[]
}

const GAP_TIMEOUT_MS = 15_000

export function createQuizService(deps: QuizServiceDeps): QuizServiceImpl {
  const { repos, brain, bus, clock } = deps
  const log = deps.log ?? defaultLog
  const mastery = deps.mastery ?? createMasteryModel({ repos, localTime: deps.localTime })
  let onCheckpoint = deps.onCheckpointFinished ?? null
  const finishing = new Map<Id, Promise<QuizResult>>()
  const results = new Map<Id, QuizResult>()
  const examJobs = new Map<Id, Promise<void>>()

  const changed = (scope: MemoryScope, ids: Id[]) => {
    if (ids.length > 0) bus.emit('memory:changed', { scope, ids })
  }
  const language = () => repos.profile.get().promptLanguage

  const mustGet = (id: Id): Quiz => {
    const quiz = repos.quizzes.get(id)
    if (!quiz) throw new Error(`quiz ${id} not found`)
    return quiz
  }

  const subjectLabel = (quiz: Quiz) =>
    quiz.subjectIds
      .map((id) => repos.subjects.get(id)?.name)
      .filter(Boolean)
      .join(' and ') || 'this topic'

  /** Gives every question a concept: by name in the quiz's subjects, else a new concept. */
  function resolveConcepts(quiz: Quiz): Quiz {
    const subjectNames = new Set(
      quiz.subjectIds.map((id) => normalize(repos.subjects.get(id)?.name ?? '')),
    )
    const questions = quiz.questions.map((q): Question => {
      if (q.conceptId && repos.concepts.get(q.conceptId)) return q
      const name = q.conceptName.trim()
      for (const subjectId of quiz.subjectIds) {
        const found = repos.concepts.findByName(subjectId, name)
        if (found) return { ...q, conceptId: found.id }
      }
      const home = quiz.subjectIds[0]
      if (!home || !name || subjectNames.has(normalize(name)) || !repos.subjects.get(home)) {
        return { ...q, conceptId: null }
      }
      return { ...q, conceptId: repos.concepts.upsert({ subjectId: home, name }).id }
    })
    return { ...quiz, questions }
  }

  /** Lowest-mastery unmastered concept of the quiz's subjects that the quiz did not cover. */
  function suggestNext(quiz: Quiz): string | null {
    const covered = new Set(quiz.questions.map((q) => normalize(q.conceptName)))
    const candidates = quiz.subjectIds
      .flatMap((id) => repos.concepts.listBySubject(id))
      .filter((c) => c.status !== 'mastered' && !covered.has(normalize(c.name)))
      .sort((a, b) => a.mastery - b.mastery)
    return candidates[0]?.name ?? null
  }

  async function diagnose(
    quiz: Quiz,
  ): Promise<Pick<QuizResult, 'gaps' | 'fixPrompt' | 'nextTopic'>> {
    const misses = missesOf(quiz)
    const next = suggestNext(quiz)
    if (misses.length === 0) return { gaps: [], fixPrompt: null, nextTopic: next }
    const profile = repos.profile.get()
    const input = gapInput(misses, {
      assistant: deps.assistantName?.() ?? 'ChatGPT',
      language: profile.promptLanguage,
      profile: profile.summary || profile.aboutMe || 'Student',
    })
    try {
      const out = await brain.fixGaps(input, { timeoutMs: GAP_TIMEOUT_MS })
      if (!out.prompt.trim()) throw new Error('empty repair prompt')
      const fallback = fallbackGaps(misses, subjectLabel(quiz), next)
      return {
        gaps: out.diagnoses.length > 0 ? out.diagnoses : fallback.diagnoses,
        fixPrompt: out.prompt.trim(),
        nextTopic: out.nextTopic.trim() || fallback.nextTopic || null,
      }
    } catch (error) {
      log('gap fixer unavailable; using the template', error)
      const fallback = fallbackGaps(misses, subjectLabel(quiz), next)
      return {
        gaps: fallback.diagnoses,
        fixPrompt: fallback.prompt,
        nextTopic: fallback.nextTopic || null,
      }
    }
  }

  function statusOf(question: Question, missed: boolean): MasteryStatus {
    const concept = question.conceptId ? repos.concepts.get(question.conceptId) : null
    return concept?.status ?? (missed ? 'struggling' : 'learning')
  }

  async function doFinish(quizId: Id): Promise<QuizResult> {
    const stored = mustGet(quizId)
    if (stored.status === 'done') {
      const cached = results.get(quizId)
      if (cached) return cached
      const { correct, total, score } = scoreQuiz(stored)
      const gaps = fallbackGaps(missesOf(stored), subjectLabel(stored), suggestNext(stored))
      return {
        quizId,
        score,
        correct,
        total,
        byConcept: breakdown(stored, statusOf),
        gaps: gaps.diagnoses,
        fixPrompt: missesOf(stored).length > 0 ? gaps.prompt : null,
        nextTopic: gaps.nextTopic || null,
      }
    }
    if (stored.status === 'generating' || stored.status === 'failed') {
      throw new Error(`quiz ${quizId} is ${stored.status}`)
    }

    const quiz = resolveConcepts(stored)
    const touched = new Set<Id>()
    for (const { question, answer, correct } of answeredInOrder(quiz)) {
      if (!question.conceptId) continue
      try {
        mastery.applyAnswer(question.conceptId, correct, question.difficulty, answer.answeredAt)
        touched.add(question.conceptId)
      } catch (error) {
        log(`mastery update failed for ${question.conceptId}`, error)
      }
    }
    const gaps = await diagnose(quiz)
    const { correct, total, score } = scoreQuiz(quiz)
    const result: QuizResult = {
      quizId,
      score,
      correct,
      total,
      byConcept: breakdown(quiz, statusOf),
      ...gaps,
    }
    repos.quizzes.save({ ...quiz, status: 'done', score, completedAt: clock.nowIso() })
    results.set(quizId, result)
    changed('quizzes', [quizId])
    changed('concepts', [...touched])

    if (quiz.kind === 'checkpoint' && onCheckpoint) {
      try {
        await onCheckpoint(quizId, result)
      } catch (error) {
        log(`checkpoint handler failed for ${quizId}`, error)
      }
    }
    return result
  }

  async function runExam(quizId: Id, spec: ExamSpec): Promise<void> {
    let questions: Question[] = []
    try {
      const nowIso = clock.nowIso()
      const generated = await generateExamQuestions(
        { repos, brain, log, language: language(), nowIso },
        spec,
      )
      questions = generated.questions
    } catch (error) {
      log(`exam ${quizId} failed`, error)
    }
    const current = repos.quizzes.get(quizId)
    if (!current) return
    repos.quizzes.save({ ...current, questions, status: questions.length > 0 ? 'ready' : 'failed' })
    changed('quizzes', [quizId])
  }

  function track(quizId: Id, job: Promise<void>): void {
    const guarded = job
      .catch((error: unknown) => log(`exam ${quizId} could not be saved`, error))
      .finally(() => examJobs.delete(quizId))
    examJobs.set(quizId, guarded)
  }

  return {
    get: mustGet,

    answer(quizId, questionId, chosenIndex): AnswerResult {
      const quiz = mustGet(quizId)
      if (finishing.has(quizId) || (quiz.status !== 'ready' && quiz.status !== 'in_progress')) {
        throw new Error(`quiz ${quizId} is not open for answers`)
      }
      const question = quiz.questions.find((q) => q.id === questionId)
      if (!question) throw new Error(`question ${questionId} is not in quiz ${quizId}`)
      if (!Number.isInteger(chosenIndex) || chosenIndex < 0 || chosenIndex > 3) {
        throw new Error(`invalid option ${chosenIndex}`)
      }
      const correct = chosenIndex === question.correctIndex
      repos.quizzes.recordAnswer(quizId, {
        questionId,
        chosenIndex,
        correct,
        answeredAt: clock.nowIso(),
      })
      return {
        correct,
        correctIndex: question.correctIndex,
        rationale: question.rationales[chosenIndex] ?? '',
      }
    },

    finish(quizId) {
      const inflight = finishing.get(quizId)
      if (inflight) return inflight
      const job = doFinish(quizId).finally(() => finishing.delete(quizId))
      finishing.set(quizId, job)
      return job
    },

    async createExam(input) {
      const spec = ExamSpec.parse(input)
      const subjects = spec.subjectIds.flatMap((id) => {
        const s = repos.subjects.get(id)
        return s ? [s] : []
      })
      if (subjects.length === 0) throw new Error('Pick at least one subject for the exam')
      const quiz: Quiz = {
        id: newId('quz'),
        kind: 'exam',
        title: examTitle(subjects, spec),
        subjectIds: subjects.map((s) => s.id),
        roadmapId: null,
        roadmapItemId: null,
        status: 'generating',
        questions: [],
        answers: [],
        score: null,
        createdAt: clock.nowIso(),
        completedAt: null,
      }
      repos.quizzes.save(quiz)
      changed('quizzes', [quiz.id])
      track(quiz.id, runExam(quiz.id, { ...spec, subjectIds: quiz.subjectIds }))
      return quiz
    },

    async startReview(conceptIds) {
      const nowIso = clock.nowIso()
      const concepts = pickReviewConcepts(repos, conceptIds, nowIso)
      if (concepts.length === 0) throw new Error('Nothing to review yet')
      const { questions } = await generateReviewQuestions(
        { repos, brain, log, language: language() },
        concepts,
      )
      const quiz: Quiz = {
        id: newId('quz'),
        kind: 'review',
        title: reviewTitle(concepts),
        subjectIds: [...new Set(concepts.map((c) => c.subjectId))],
        roadmapId: null,
        roadmapItemId: null,
        status: questions.length > 0 ? 'ready' : 'failed',
        questions,
        answers: [],
        score: null,
        createdAt: nowIso,
        completedAt: null,
      }
      repos.quizzes.save(quiz)
      changed('quizzes', [quiz.id])
      return quiz
    },

    setCheckpointHandler(handler) {
      onCheckpoint = handler
    },

    async settled() {
      while (examJobs.size > 0) await Promise.allSettled([...examJobs.values()])
    },

    recoverInterrupted() {
      const stale = repos.quizzes
        .list({ kind: 'exam' })
        .filter((q) => q.status === 'generating' && !examJobs.has(q.id))
      for (const q of stale) repos.quizzes.save({ ...q, status: 'failed' })
      changed(
        'quizzes',
        stale.map((q) => q.id),
      )
      return stale.map((q) => q.id)
    },
  }
}
