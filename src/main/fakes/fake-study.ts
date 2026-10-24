/**
 * Fake StudyService (lane L4 builds the real one): walks a roadmap from the Brain step by step.
 *
 * start → build (or resume) the roadmap and paste step 1; next → mark the current item done and
 * paste the next step, or open the checkpoint quiz; when the quiz is finished the session moves
 * past the checkpoint. Enough behaviour for the demo and for the shell's end-to-end tests.
 */
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { ChatContext, QueryService, Repos, StudyService } from '@engine/contracts'
import { newId } from '@engine/ids'
import type { Id, Quiz, Roadmap, RoadmapItem, Subject } from '@shared/domain'
import type { PickerData, SessionState, StartSessionInput, StepInstruction } from '@shared/state'

export interface FakeStudyDeps {
  brain: Brain
  repos: Repos
  clock: Clock
  queries: QueryService
}

type Phase = SessionState['phase']

export class FakeStudyService implements StudyService {
  private roadmapId: Id | null = null
  private index = 0
  private phase: Phase = 'step'
  private assistant: string | null = null
  private error: string | null = null
  private readonly listeners = new Set<(session: SessionState | null) => void>()

  constructor(private readonly deps: FakeStudyDeps) {}

  current(): SessionState | null {
    const roadmap = this.roadmapId ? this.deps.repos.roadmaps.get(this.roadmapId) : null
    if (!roadmap) return null
    const subject = this.deps.repos.subjects.get(roadmap.subjectId)
    return {
      roadmapId: roadmap.id,
      subjectId: roadmap.subjectId,
      subjectName: subject?.name ?? 'Subject',
      subjectEmoji: subject?.emoji ?? '📘',
      title: roadmap.title,
      phase: this.phase,
      index: Math.min(this.index, Math.max(0, roadmap.items.length - 1)),
      total: roadmap.items.length,
      items: roadmap.items,
      nextAction: this.nextAction(roadmap),
      assistant: this.assistant,
      startReason: roadmap.startReason,
      offerPlacement: roadmap.offerPlacement,
      error: this.error,
    }
  }

  picker(): PickerData {
    return this.deps.queries.picker()
  }

  async start(input: StartSessionInput, ctx: ChatContext): Promise<StepInstruction> {
    const { repos } = this.deps
    const goal = (input.goal ?? input.question ?? '').trim()
    const subject = this.resolveSubject(input.subjectId, goal)
    this.assistant = ctx.assistant
    this.error = null
    const existing = repos.roadmaps.getActive(subject.id)
    if (existing && !goal) {
      this.roadmapId = existing.id
      const resumeAt = existing.items.findIndex((i) => i.status !== 'done')
      return this.enter(existing, resumeAt < 0 ? existing.items.length : resumeAt, ctx)
    }
    this.roadmapId = null
    this.phase = 'planning'
    this.emit()
    try {
      const roadmap = await this.plan(subject, goal || subject.goal || subject.name, ctx)
      repos.roadmaps.save(roadmap)
      this.roadmapId = roadmap.id
      return await this.enter(roadmap, 0, ctx)
    } catch (error) {
      this.phase = 'error'
      this.error = error instanceof Error ? error.message : String(error)
      this.emit()
      throw error
    }
  }

  async next(ctx: ChatContext): Promise<StepInstruction> {
    const roadmap = this.roadmapId ? this.deps.repos.roadmaps.get(this.roadmapId) : null
    if (!roadmap) return { kind: 'wait', reason: 'No study session is running.' }
    if (this.phase === 'complete') return this.complete(roadmap)
    const item = roadmap.items[this.index]
    if (item?.kind === 'checkpoint') {
      const quiz = item.quizId ? this.deps.repos.quizzes.get(item.quizId) : null
      if (quiz && quiz.status !== 'done') return { kind: 'quiz', quizId: quiz.id, itemId: item.id }
    }
    if (item) this.setItem(roadmap, this.index, { status: 'done' })
    return this.enter(roadmap, this.index + 1, ctx)
  }

  pause(): void {
    if (!this.roadmapId) return
    this.phase = 'paused'
    this.emit()
  }

  end(): void {
    const roadmap = this.roadmapId ? this.deps.repos.roadmaps.get(this.roadmapId) : null
    if (roadmap && roadmap.status === 'active') {
      this.deps.repos.roadmaps.save({ ...roadmap, status: 'paused', updatedAt: this.now() })
    }
    this.roadmapId = null
    this.phase = 'step'
    this.emit()
  }

  onChange(listener: (session: SessionState | null) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** Called by the fake QuizService when a quiz is finished. */
  onQuizFinished(quiz: Quiz): void {
    const roadmap = this.roadmapId ? this.deps.repos.roadmaps.get(this.roadmapId) : null
    const item = roadmap?.items[this.index]
    if (!roadmap || item?.kind !== 'checkpoint' || item.quizId !== quiz.id) return
    const missed = quiz.questions
      .filter((q) => quiz.answers.some((a) => a.questionId === q.id && !a.correct))
      .map((q) => q.conceptName)
    const updated = this.setItem(roadmap, this.index, { score: quiz.score })
    this.deps.repos.roadmaps.save({
      ...updated,
      carry: [...new Set([...updated.carry, ...missed])],
      updatedAt: this.now(),
    })
    this.emit()
  }

  // ─── internals ──────────────────────────────────────────────────────────────────────────

  private resolveSubject(subjectId: Id | null, goal: string): Subject {
    const { repos } = this.deps
    const byId = subjectId ? repos.subjects.get(subjectId) : null
    if (byId) return byId
    const name = goal.length > 0 ? goal.slice(0, 48) : 'General'
    return repos.subjects.findByName(name) ?? repos.subjects.create({ name, emoji: '📘', goal })
  }

  private async plan(subject: Subject, goal: string, ctx: ChatContext): Promise<Roadmap> {
    const { repos, brain } = this.deps
    const concepts = repos.concepts.listBySubject(subject.id)
    const plan = await brain.buildRoadmap({
      goal,
      subject: { id: subject.id, name: subject.name },
      deadline: subject.deadline,
      minutesAvailable: null,
      assistant: ctx.assistant ?? 'ChatGPT',
      language: 'auto',
      profile: repos.profile.get().summary,
      mastery: concepts.map((c) => ({ concept: c.name, status: c.status, evidence: '' })),
      encounters: repos.encounters
        .list({ subjectId: subject.id, limit: 20 })
        .map((e) => ({ seen: e.seen, bigPicture: e.bigPicture, understanding: e.understanding })),
      openQuestions: repos.encounters.openQuestions(subject.id, 5),
      doneSteps: [],
      carry: [],
    })
    let checkpoints = 0
    const items: RoadmapItem[] = plan.items.map((p, idx) =>
      p.kind === 'learn'
        ? { ...p, id: newId('itm'), idx, promptSent: null, status: 'todo' }
        : {
            kind: 'checkpoint',
            id: newId('itm'),
            idx,
            title: `Checkpoint ${++checkpoints}`,
            covers: p.covers,
            probes: p.probes,
            nQuestions: p.nQuestions,
            quizId: null,
            score: null,
            status: 'todo',
          },
    )
    const t = this.now()
    return {
      id: newId('rdm'),
      subjectId: subject.id,
      title: plan.title,
      goal: plan.goal,
      startReason: plan.startReason,
      offerPlacement: plan.offerPlacement,
      estimatedMinutes: plan.estimatedMinutes,
      status: 'active',
      items,
      carry: [],
      nextMilestone: plan.nextMilestone,
      createdAt: t,
      updatedAt: t,
    }
  }

  /** Makes item `i` current and returns what the shell should do for it. */
  private async enter(roadmap: Roadmap, i: number, ctx: ChatContext): Promise<StepInstruction> {
    this.index = i
    const item = roadmap.items[i]
    if (!item) return this.complete(roadmap)
    if (item.kind === 'learn') {
      const step = await this.deps.brain.writeStep({
        assistant: ctx.assistant ?? 'ChatGPT',
        language: 'auto',
        profile: this.deps.repos.profile.get().summary,
        step: {
          title: item.title,
          objective: item.objective,
          move: item.move,
          promptDraft: item.promptDraft,
        },
        chatExcerpt: ctx.chatExcerpt,
        recentMisses: roadmap.carry.map((concept) => ({ concept, misconception: 'missed before' })),
      })
      this.setItem(roadmap, i, { status: 'current', promptSent: step.prompt })
      this.phase = 'step'
      this.emit()
      return { kind: 'paste', text: step.prompt, coachTip: step.coachTip, itemId: item.id }
    }
    const quiz = await this.makeCheckpointQuiz(roadmap, item)
    this.setItem(roadmap, i, { status: 'current', quizId: quiz.id })
    this.phase = 'checkpoint'
    this.emit()
    return { kind: 'quiz', quizId: quiz.id, itemId: item.id }
  }

  private async makeCheckpointQuiz(
    roadmap: Roadmap,
    item: Extract<RoadmapItem, { kind: 'checkpoint' }>,
  ): Promise<Quiz> {
    const drafts = await this.deps.brain.makeCheckpoint({
      concepts: item.covers,
      probes: item.probes,
      carry: roadmap.carry,
      n: Math.max(1, Math.min(5, item.nQuestions)),
      studied: '',
      language: 'auto',
    })
    const quiz: Quiz = {
      id: newId('quz'),
      kind: 'checkpoint',
      title: `${roadmap.title} · ${item.title}`,
      subjectIds: [roadmap.subjectId],
      roadmapId: roadmap.id,
      roadmapItemId: item.id,
      status: 'ready',
      questions: drafts.map((d) => ({
        id: newId('qst'),
        conceptName: d.concept,
        conceptId: null,
        stem: d.stem,
        options: d.options,
        correctIndex: d.correctIndex,
        rationales: d.rationales,
        difficulty: d.difficulty,
        carriedFrom: roadmap.carry.includes(d.concept) ? roadmap.id : null,
      })),
      answers: [],
      score: null,
      createdAt: this.now(),
      completedAt: null,
    }
    this.deps.repos.quizzes.save(quiz)
    return quiz
  }

  private complete(roadmap: Roadmap): StepInstruction {
    this.index = roadmap.items.length
    if (roadmap.status !== 'done') {
      this.deps.repos.roadmaps.save({ ...roadmap, status: 'done', updatedAt: this.now() })
    }
    this.phase = 'complete'
    this.emit()
    return { kind: 'complete', summary: `Roadmap complete: ${roadmap.title}` }
  }

  private nextAction(roadmap: Roadmap): SessionState['nextAction'] {
    if (this.phase === 'complete' || this.phase === 'planning' || this.phase === 'error') {
      return 'none'
    }
    const item = roadmap.items[this.index]
    if (item?.kind === 'checkpoint' && item.score === null) return 'open_quiz'
    const following = roadmap.items[this.index + 1]
    if (!following) return 'finish'
    return following.kind === 'checkpoint' ? 'open_quiz' : 'paste_next'
  }

  private setItem(roadmap: Roadmap, i: number, patch: Partial<RoadmapItem>): Roadmap {
    const items = roadmap.items.map((item, k) =>
      k === i ? ({ ...item, ...patch } as RoadmapItem) : item,
    )
    roadmap.items = items
    roadmap.updatedAt = this.now()
    this.deps.repos.roadmaps.save(roadmap)
    return roadmap
  }

  private now(): string {
    return this.deps.clock.nowIso()
  }

  private emit(): void {
    const session = this.current()
    for (const listener of [...this.listeners]) listener(session)
  }
}
