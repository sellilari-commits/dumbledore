/**
 * StudyService (lane L4, PLAN F2/§6.6): the study session inside an AI chat. Builds or resumes a
 * roadmap, writes each step's prompt for the shell to paste, runs just-in-time checkpoints with
 * carry-over, and rebuilds itself from the stored roadmap after a restart.
 */
import type { CheckpointItem, Id, LearnItem, Quiz, QuizResult, Roadmap } from '@shared/domain'
import type { PickerData, SessionState, StartSessionInput, StepInstruction } from '@shared/state'
import type { ChatContext, StudyService } from '../../contracts'
import { newId } from '../../ids'
import { AnswerWatch, hasAnswer } from './answer-watch'
import { resultFromQuiz, roadmapAfterResult } from './checkpoint-result'
import { errorMessage } from './deadline'
import { DEFAULT_STUDY_OPTIONS, type StudyDeps, type StudyOptions } from './deps'
import { touchConcepts } from './memory-updates'
import { buildPicker } from './picker'
import { commitRoadmap, parkRoadmap, planRoadmap, saveRoadmap } from './planner'
import { CheckpointQuizzes } from './quiz-cache'
import {
  closeItem,
  completionSummary,
  currentIndex,
  deferCheckpoint,
  isCheckpoint,
  isDelivered,
  isLearn,
  nextOpenItem,
} from './roadmap-ops'
import {
  metaFor,
  planningState,
  planningWait,
  roadmapState,
  SessionGate,
  SessionListeners,
  type SessionMeta,
  StudyError,
  waitFor,
} from './session-state'
import { openRoadmap, resolveTarget, type SessionTarget, shouldResume } from './session-target'
import { deliverLearnStep, redeliverStep } from './step-writer'
import { refineNewSubject } from './subject-naming'
import { UnpastedSteps } from './unpasted'

/** A second tap on a waiting step within this long moves on without the answer. */
const INSIST_MS = 15_000

export class StudyServiceImpl implements StudyService {
  private readonly opts: StudyOptions
  private readonly quizzes: CheckpointQuizzes
  private readonly gate = new SessionGate()
  private readonly listeners = new SessionListeners()
  private readonly unpasted = new UnpastedSteps()
  /** Watches the live chat for the answer to the step whose prompt was sent. */
  private readonly answers: AnswerWatch
  /** The first tap on a sent but unanswered step: a second tap soon after moves on anyway. */
  private waitedOn: { itemId: Id; at: number } | null = null
  private meta: SessionMeta | null = null

  constructor(private readonly deps: StudyDeps) {
    this.opts = { ...DEFAULT_STUDY_OPTIONS, ...deps.options }
    this.quizzes = new CheckpointQuizzes(deps, this.opts)
    this.answers = new AnswerWatch(deps.clock, deps.chatExcerpt ?? null, (id) =>
      this.markAnswered(id),
    )
    const active = deps.repos.roadmaps.listActive()[0]
    if (active) {
      this.meta = metaFor(active, null)
      this.watchSentStep(active) // a step sent before a restart still waits for its answer
    }
  }

  current(): SessionState | null {
    const meta = this.meta
    if (!meta) return null
    const { repos } = this.deps
    if (meta.phase === 'planning') return planningState(meta, repos.subjects.get(meta.subjectId))
    const roadmap = repos.roadmaps.get(meta.roadmapId)
    return roadmap ? roadmapState(meta, roadmap, repos.subjects.get(roadmap.subjectId)) : null
  }

  picker(): PickerData {
    return buildPicker(this.deps.repos, this.deps.clock.nowIso())
  }

  onChange(listener: (session: SessionState | null) => void): () => void {
    return this.listeners.add(listener)
  }

  async start(input: StartSessionInput, ctx: ChatContext): Promise<StepInstruction> {
    const waiting = this.gate.waiting()
    if (waiting) return waiting
    const seq = this.gate.begin('start')
    try {
      const target = resolveTarget(this.deps.repos, input)
      const open = openRoadmap(this.deps.repos, target.subject.id)
      if (shouldResume(open, target.goal)) return await this.resume(open, ctx)
      return await this.plan(target, ctx)
    } finally {
      this.gate.finish(seq)
    }
  }

  async next(ctx: ChatContext): Promise<StepInstruction> {
    const meta = this.meta
    if (!meta) throw new StudyError('No study session is running.')
    if (meta.phase === 'planning') return planningWait()
    const waiting = this.gate.waiting()
    if (waiting) return waiting
    const seq = this.gate.begin('next')
    try {
      if (ctx.assistant) meta.assistant = ctx.assistant
      const roadmap = this.load()
      if (roadmap.status === 'done') return this.complete(roadmap)
      if (meta.phase === 'paused') return await this.resume(roadmap, ctx)
      const idx = currentIndex(roadmap)
      const item = roadmap.items[idx]
      if (!item) return this.complete(roadmap)
      // An unanswered checkpoint can't be skipped: hand out the same quiz again.
      if (isCheckpoint(item)) return await this.deliverCheckpoint(roadmap, item, ctx)
      if (!isDelivered(item)) return await this.deliverLearn(roadmap, item, ctx)
      // A step is done only once the student got the AI's answer to it (Ilari, 2026-10-25).
      if (this.opts.requireAnswer && !this.answeredNow(item, ctx) && !this.insists(item.id)) {
        this.waitedOn = { itemId: item.id, at: this.deps.clock.now() }
        const who = ctx.assistant ?? meta.assistant ?? 'the AI'
        return waitFor(`Waiting for ${who}'s answer to this step. Press again to move on anyway.`)
      }
      this.closeLearn(roadmap, idx)
      return await this.deliverCurrent(ctx)
    } finally {
      this.gate.finish(seq)
    }
  }

  async skipCheckpoint(itemId: Id, ctx: ChatContext): Promise<StepInstruction> {
    const meta = this.meta
    if (!meta) throw new StudyError('No study session is running.')
    if (meta.phase === 'planning') return planningWait()
    const waiting = this.gate.waiting()
    if (waiting) return waiting
    const seq = this.gate.begin('next')
    try {
      if (ctx.assistant) meta.assistant = ctx.assistant
      const roadmap = this.load()
      const deferred = deferCheckpoint(roadmap, itemId, this.deps.clock.nowIso())
      if (deferred !== roadmap) {
        this.save(roadmap, deferred)
        this.quizzes.clearFailures(itemId)
        this.settle()
      }
      if (deferred.status === 'done') return this.complete(deferred)
      return await this.deliverCurrent(ctx)
    } finally {
      this.gate.finish(seq)
    }
  }

  pasteFailed(itemId: Id): void {
    if (this.answers.watching === itemId) this.answers.stop()
    const meta = this.meta
    const roadmap = meta ? this.deps.repos.roadmaps.get(meta.roadmapId) : null
    if (!roadmap || !this.unpasted.fail(this.deps.repos, roadmap, itemId, this.deps.clock.nowIso()))
      return
    this.deps.bus.emit('memory:changed', { scope: 'roadmaps', ids: [roadmap.id] })
    this.emitChange()
  }

  pause(): void {
    const meta = this.meta
    if (!meta || meta.phase === 'planning' || meta.phase === 'paused') return
    if (this.current()?.phase === 'complete') return
    this.quizzes.cancelScheduled()
    this.answers.stop()
    parkRoadmap(this.deps.repos, meta.roadmapId, this.deps.clock.nowIso())
    meta.phase = 'paused'
    meta.error = null
    this.emitChange()
  }

  end(): void {
    const meta = this.meta
    if (!meta) return
    this.gate.cancel()
    this.quizzes.cancelScheduled()
    this.answers.stop()
    parkRoadmap(this.deps.repos, meta.roadmapId, this.deps.clock.nowIso())
    this.meta = null
    this.emitChange()
  }

  /**
   * Called by lane L5's QuizService when a checkpoint quiz is finished: records the score, carries
   * misses into the next checkpoint (re-passed concepts leave the carry set) and advances.
   * Unknown or already-recorded results are ignored.
   */
  handleCheckpointResult(quizId: Id, result: QuizResult): void {
    const quiz = this.deps.repos.quizzes.get(quizId)
    if (quiz && this.applyResult(quiz, result)) this.emitChange()
  }

  // ─── Planning ─────────────────────────────────────────────────────────────────────────────

  private async resume(roadmap: Roadmap, ctx: ChatContext): Promise<StepInstruction> {
    const { repos, clock } = this.deps
    if (this.meta && this.meta.roadmapId !== roadmap.id)
      parkRoadmap(repos, this.meta.roadmapId, clock.nowIso())
    if (roadmap.status !== 'active')
      repos.roadmaps.save({ ...roadmap, status: 'active', updatedAt: clock.nowIso() })
    this.meta = metaFor(roadmap, ctx.assistant ?? this.meta?.assistant ?? null)
    this.emitChange()
    return this.deliverCurrent(ctx)
  }

  private async plan(target: SessionTarget, ctx: ChatContext): Promise<StepInstruction> {
    const { subject } = target
    const goal = target.goal ?? subject.goal ?? subject.name
    const epoch = this.gate.epoch
    const previous = this.meta
    const id = newId('rdm')
    this.meta = {
      ...metaFor({ id, subjectId: subject.id }, ctx.assistant),
      phase: 'planning',
      planningGoal: goal,
    }
    this.emitChange()
    let roadmap: Roadmap
    try {
      roadmap = await planRoadmap(this.deps, this.opts, {
        id,
        subject,
        goal,
        question: target.question,
        assistant: ctx.assistant ?? this.opts.defaultAssistant,
      })
    } catch (error) {
      // PLAN §6.6: planning ──fail──▶ available (the previous session, if any). The shell tells.
      if (epoch === this.gate.epoch) {
        this.meta = previous
        this.emitChange()
      }
      throw error
    }
    if (epoch !== this.gate.epoch) return waitFor('Cancelled.')
    if (target.topicNamed) roadmap = refineNewSubject(this.deps, subject, roadmap)
    commitRoadmap(this.deps.repos, roadmap)
    if (previous) parkRoadmap(this.deps.repos, previous.roadmapId, this.deps.clock.nowIso())
    this.deps.bus.emit('memory:changed', { scope: 'roadmaps', ids: [roadmap.id] })
    this.meta = metaFor(roadmap, ctx.assistant)
    this.emitChange()
    return this.deliverCurrent(ctx)
  }

  // ─── Delivering items ─────────────────────────────────────────────────────────────────────

  private async deliverCurrent(ctx: ChatContext): Promise<StepInstruction> {
    const roadmap = this.load()
    const item = roadmap.items[currentIndex(roadmap)]
    if (roadmap.status === 'done' || !item) return this.complete(roadmap)
    return isLearn(item)
      ? this.deliverLearn(roadmap, item, ctx)
      : this.deliverCheckpoint(roadmap, item, ctx)
  }

  private async deliverLearn(
    roadmap: Roadmap,
    item: LearnItem,
    ctx: ChatContext,
  ): Promise<StepInstruction> {
    // A step whose paste failed is handed out again word for word.
    const again = this.unpasted.retry(item.id)
    const delivered = again
      ? redeliverStep(this.deps, { roadmap, item, instruction: again })
      : await deliverLearnStep(this.deps, this.opts, {
          roadmap,
          item,
          chatExcerpt: ctx.chatExcerpt,
          assistant: ctx.assistant ?? this.meta?.assistant ?? this.opts.defaultAssistant,
          isCurrent: () => this.meta?.roadmapId === roadmap.id,
        })
    if (!delivered) return waitFor('The study session ended.')
    this.unpasted.handedOut(delivered.instruction)
    this.watchSentStep(delivered.roadmap)
    this.settle()
    this.emitChange()
    // D11: the checkpoint after this step is generated while the student reads it.
    const following = nextOpenItem(delivered.roadmap, item.idx)
    if (isCheckpoint(following)) {
      // With a live chat feed, wait until the AI has answered this step before generating.
      const live = this.deps.chatExcerpt
      const excerpt = () => live?.(this.opts.studiedExcerptChars) || ctx.chatExcerpt
      const delay = live ? this.opts.prefetchDelayMs : 0
      this.quizzes.prefetchCheckpoint(delivered.roadmap.id, following.id, excerpt, delay)
    }
    return delivered.instruction
  }

  private async deliverCheckpoint(
    roadmap: Roadmap,
    item: CheckpointItem,
    ctx: ChatContext,
  ): Promise<StepInstruction> {
    const stored = this.quizzes.stored(roadmap.id, item.id)
    // Finished, but the result never reached us (e.g. a restart in between): apply it now.
    if (stored?.status === 'done' && this.applyResult(stored, resultFromQuiz(stored))) {
      return this.deliverCurrent(ctx)
    }
    try {
      const quiz = await this.quizzes.ensure(this.quizzes.request(roadmap, item, ctx.chatExcerpt))
      if (this.meta?.roadmapId !== roadmap.id) return waitFor('The study session ended.')
      this.quizzes.clearFailures(item.id)
      this.settle()
      this.emitChange()
      // The shell asks "quiz or continue?" first and opens the quiz card only on "Quiz".
      return { kind: 'quiz', quizId: quiz.id, itemId: item.id }
    } catch (error) {
      return this.checkpointFailed(item, ctx, error)
    }
  }

  private async checkpointFailed(
    item: CheckpointItem,
    ctx: ChatContext,
    error: unknown,
  ): Promise<StepInstruction> {
    if (this.quizzes.recordFailure(item.id) >= this.opts.maxCheckpointFailures) {
      // Don't block the roadmap forever: skip it. Carried misses move on to the next checkpoint.
      this.quizzes.clearFailures(item.id)
      const roadmap = this.load()
      this.save(roadmap, closeItem(roadmap, item.idx, this.deps.clock.nowIso(), 'skipped'))
      this.settle()
      return this.deliverCurrent(ctx)
    }
    const message = `Couldn't prepare the checkpoint quiz (${errorMessage(error)}). Press Next to try again.`
    if (this.meta) {
      this.meta.phase = 'error'
      this.meta.error = message
    }
    this.emitChange()
    throw new StudyError(message, { cause: error })
  }

  private complete(roadmap: Roadmap): StepInstruction {
    const done: Roadmap =
      roadmap.status === 'done'
        ? roadmap
        : { ...roadmap, status: 'done', updatedAt: this.deps.clock.nowIso() }
    if (done !== roadmap) this.save(roadmap, done)
    this.settle()
    this.emitChange()
    return { kind: 'complete', summary: completionSummary(done) }
  }

  // ─── Waiting for the answer ───────────────────────────────────────────────────────────────

  /** Starts watching the chat when the roadmap's current step was sent but isn't done. */
  private watchSentStep(roadmap: Roadmap): void {
    if (!this.opts.requireAnswer) return
    const item = roadmap.items[currentIndex(roadmap)]
    if (!isLearn(item) || !isDelivered(item) || item.status === 'done') return
    if (this.answers.watching === item.id) return
    this.answers.start({
      itemId: item.id,
      prompt: item.promptSent ?? item.promptDraft,
      assistant: this.meta?.assistant ?? null,
    })
  }

  /** On a tap: is the answer to this step already in the chat? */
  private answeredNow(item: LearnItem, ctx: ChatContext): boolean {
    const prompt = item.promptSent ?? item.promptDraft
    const live = this.deps.chatExcerpt?.(this.opts.studiedExcerptChars)
    const assistant = ctx.assistant ?? this.meta?.assistant ?? null
    return [live, ctx.chatExcerpt].some((t) => !!t && hasAnswer(t, prompt, assistant))
  }

  /** A second tap within a short while on the same waiting step: the student moves on anyway. */
  private insists(itemId: Id): boolean {
    const w = this.waitedOn
    return !!w && w.itemId === itemId && this.deps.clock.now() - w.at <= INSIST_MS
  }

  /** The watcher saw a full answer: the step is done (the next tap hands out the next one). */
  private markAnswered(itemId: Id): void {
    const meta = this.meta
    const roadmap = meta ? this.deps.repos.roadmaps.get(meta.roadmapId) : null
    if (!roadmap) return
    const idx = currentIndex(roadmap)
    const item = roadmap.items[idx]
    if (!isLearn(item) || item.id !== itemId || !isDelivered(item)) return
    this.closeLearn(roadmap, idx)
    this.settle()
    this.emitChange()
  }

  private closeLearn(roadmap: Roadmap, idx: number): void {
    const item = roadmap.items[idx]
    if (!isLearn(item)) return
    if (this.answers.watching === item.id) this.answers.stop()
    if (this.waitedOn?.itemId === item.id) this.waitedOn = null
    this.save(roadmap, closeItem(roadmap, idx, this.deps.clock.nowIso()))
    touchConcepts(this.deps, roadmap.subjectId, item.concepts)
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────────────────────

  private save(before: Roadmap, after: Roadmap): void {
    saveRoadmap(this.deps, before, after)
  }

  /** Records a checkpoint result on its roadmap; false when it doesn't apply (or already did). */
  private applyResult(quiz: Quiz, result: QuizResult): boolean {
    const roadmap = quiz.roadmapId ? this.deps.repos.roadmaps.get(quiz.roadmapId) : null
    const after = roadmap && roadmapAfterResult(roadmap, quiz, result, this.deps.clock.nowIso())
    if (!roadmap || !after) return false
    this.save(roadmap, after)
    if (quiz.roadmapItemId) this.quizzes.clearFailures(quiz.roadmapItemId)
    if (this.meta?.roadmapId === after.id) this.settle()
    return true
  }

  private load(): Roadmap {
    const roadmap = this.meta ? this.deps.repos.roadmaps.get(this.meta.roadmapId) : null
    if (!roadmap) throw new StudyError('The study session is no longer available.')
    return roadmap
  }

  /** Back to the phase the roadmap implies (a pause sticks until the student resumes). */
  private settle(): void {
    if (!this.meta || this.meta.phase === 'paused') return
    this.meta.phase = null
    this.meta.error = null
  }

  private emitChange(): void {
    this.listeners.emit(this.deps.bus, this.current())
  }
}

export function createStudyService(deps: StudyDeps): StudyServiceImpl {
  return new StudyServiceImpl(deps)
}
