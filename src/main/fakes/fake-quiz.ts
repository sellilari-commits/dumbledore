/**
 * Fake QuizService (lane L5 builds the real one): scoring, exams and reviews over `Repos` with
 * questions from the Brain. Exams are created as 'generating' and filled in the background, like
 * the real service, announcing completion with memory:changed.
 */
import type { Brain, QuestionDraft } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { QuizService, Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { newId } from '@engine/ids'
import type {
  AnswerResult,
  ExamSpec,
  Id,
  MasteryStatus,
  Question,
  Quiz,
  QuizKind,
  QuizResult,
} from '@shared/domain'

export interface FakeQuizDeps {
  brain: Brain
  repos: Repos
  clock: Clock
  bus: EngineBus
  /** Lets the fake study session move past a finished checkpoint. */
  onFinished?: (quiz: Quiz) => void
}

function toQuestion(d: QuestionDraft): Question {
  return {
    id: newId('qst'),
    conceptName: d.concept,
    conceptId: null,
    stem: d.stem,
    options: d.options,
    correctIndex: d.correctIndex,
    rationales: d.rationales,
    difficulty: d.difficulty,
    carriedFrom: null,
  }
}

export class FakeQuizService implements QuizService {
  constructor(private readonly deps: FakeQuizDeps) {}

  get(id: Id): Quiz {
    const quiz = this.deps.repos.quizzes.get(id)
    if (!quiz) throw new Error(`Quiz ${id} not found`)
    return quiz
  }

  answer(quizId: Id, questionId: Id, chosenIndex: number): AnswerResult {
    const quiz = this.get(quizId)
    const question = quiz.questions.find((q) => q.id === questionId)
    if (!question) throw new Error(`Question ${questionId} is not in quiz ${quizId}`)
    const correct = chosenIndex === question.correctIndex
    this.deps.repos.quizzes.recordAnswer(quizId, {
      questionId,
      chosenIndex,
      correct,
      answeredAt: this.deps.clock.nowIso(),
    })
    return {
      correct,
      correctIndex: question.correctIndex,
      rationale: question.rationales[chosenIndex] ?? '',
    }
  }

  async finish(quizId: Id): Promise<QuizResult> {
    const quiz = this.get(quizId)
    const answered = new Map(quiz.answers.map((a) => [a.questionId, a]))
    const total = quiz.questions.length
    const correct = quiz.questions.filter((q) => answered.get(q.id)?.correct).length
    const score = total > 0 ? correct / total : 0
    const misses = quiz.questions.filter((q) => !answered.get(q.id)?.correct)
    const byConcept = new Map<string, { correct: number; total: number }>()
    for (const q of quiz.questions) {
      const row = byConcept.get(q.conceptName) ?? { correct: 0, total: 0 }
      row.total++
      if (answered.get(q.id)?.correct) row.correct++
      byConcept.set(q.conceptName, row)
    }
    let fixPrompt: string | null = null
    let nextTopic: string | null = null
    let gaps = misses.map((q) => ({
      concept: q.conceptName,
      misconception: q.options[answered.get(q.id)?.chosenIndex ?? 0] ?? 'Unanswered',
    }))
    if (misses.length > 0) {
      const fix = await this.deps.brain.fixGaps({
        assistant: 'ChatGPT',
        language: 'auto',
        profile: this.deps.repos.profile.get().summary,
        misses: misses.map((q) => ({
          concept: q.conceptName,
          stem: q.stem,
          chosen: q.options[answered.get(q.id)?.chosenIndex ?? 0] ?? '',
          correct: q.options[q.correctIndex] ?? '',
          rationale: q.rationales[q.correctIndex] ?? '',
        })),
      })
      fixPrompt = fix.prompt
      nextTopic = fix.nextTopic
      gaps = fix.diagnoses
    }
    const done: Quiz = {
      ...quiz,
      status: 'done',
      score,
      completedAt: this.deps.clock.nowIso(),
    }
    this.deps.repos.quizzes.save(done)
    this.deps.onFinished?.(done)
    this.deps.bus.emit('memory:changed', { scope: 'quizzes', ids: [quizId] })
    const status = (r: { correct: number; total: number }): MasteryStatus =>
      r.correct === r.total ? 'mastered' : r.correct === 0 ? 'struggling' : 'learning'
    return {
      quizId,
      score,
      correct,
      total,
      byConcept: [...byConcept].map(([conceptName, r]) => ({
        conceptName,
        ...r,
        status: status(r),
      })),
      gaps,
      fixPrompt,
      nextTopic,
    }
  }

  async createExam(spec: ExamSpec): Promise<Quiz> {
    const { repos } = this.deps
    const subjects = spec.subjectIds.map((id) => repos.subjects.get(id)).filter((s) => s !== null)
    const title = `${spec.focus === 'weak' ? 'Weak-spots' : spec.focus === 'due' ? 'Due' : 'Full'} exam · ${subjects.map((s) => s.name).join(', ') || 'Mixed'}`
    const quiz = this.blank('exam', title, spec.subjectIds, 'generating')
    repos.quizzes.save(quiz)
    void this.fillExam(quiz, spec)
    return quiz
  }

  async startReview(conceptIds: Id[]): Promise<Quiz> {
    const concepts = conceptIds
      .map((id) => this.deps.repos.concepts.get(id))
      .filter((c) => c !== null)
    const names = concepts.map((c) => c.name)
    const drafts = await this.deps.brain.makeCheckpoint({
      concepts: names.length > 0 ? names : ['Recent topics'],
      probes: [],
      carry: [],
      n: Math.max(3, Math.min(5, names.length)),
      studied: '',
      language: 'auto',
    })
    const subjectIds = [...new Set(concepts.map((c) => c.subjectId))]
    const quiz = this.blank(
      'review',
      `Review · ${names.slice(0, 3).join(', ') || 'Recent topics'}`,
      subjectIds,
      'ready',
    )
    quiz.questions = drafts.map(toQuestion)
    this.deps.repos.quizzes.save(quiz)
    return quiz
  }

  private blank(kind: QuizKind, title: string, subjectIds: Id[], status: Quiz['status']): Quiz {
    return {
      id: newId('quz'),
      kind,
      title,
      subjectIds,
      roadmapId: null,
      roadmapItemId: null,
      status,
      questions: [],
      answers: [],
      score: null,
      createdAt: this.deps.clock.nowIso(),
      completedAt: null,
    }
  }

  private async fillExam(quiz: Quiz, spec: ExamSpec): Promise<void> {
    const { repos, brain } = this.deps
    try {
      const subjects = spec.subjectIds.map((id) => repos.subjects.get(id)).filter((s) => s !== null)
      const drafts = await brain.makeExam({
        subjects: subjects.map((s) => ({ id: s.id, name: s.name })),
        spec,
        concepts: subjects.flatMap((s) =>
          repos.concepts
            .listBySubject(s.id)
            .map((c) => ({ name: c.name, status: c.status, mastery: c.mastery })),
        ),
        encounters: subjects.flatMap((s) =>
          repos.encounters
            .list({ subjectId: s.id, limit: 10 })
            .map((e) => ({ seen: e.seen, bigPicture: e.bigPicture })),
        ),
        language: 'auto',
      })
      repos.quizzes.save({ ...quiz, status: 'ready', questions: drafts.map(toQuestion) })
    } catch {
      repos.quizzes.save({ ...quiz, status: 'failed' })
    }
    this.deps.bus.emit('memory:changed', { scope: 'quizzes', ids: [quiz.id] })
  }
}
