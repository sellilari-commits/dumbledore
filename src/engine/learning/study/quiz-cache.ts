/**
 * Makes sure a checkpoint has its quiz: reuses the stored one, joins an in-flight prefetch, or
 * generates it now. Quizzes are saved and linked to their item as soon as they are ready, so a
 * prefetched quiz also survives a restart. Also counts failed generations per checkpoint.
 */
import type { CheckpointItem, Id, Quiz, Roadmap } from '@shared/domain'
import type { Cancel } from '../../clock'
import type { EngineBus } from '../../events'
import {
  buildCheckpointQuiz,
  type CheckpointQuizDeps,
  type CheckpointQuizOptions,
  studiedText,
} from './checkpoint-quiz'
import { isCheckpoint, withItem } from './roadmap-ops'
import { languageOf } from './text'

export interface QuizRequest {
  roadmapId: Id
  itemId: Id
  studied: string
  language: string
}

export class CheckpointQuizzes {
  private readonly inFlight = new Map<Id, Promise<Quiz>>()
  private readonly timers = new Map<Id, Cancel>()
  private readonly failures = new Map<Id, number>()

  constructor(
    private readonly deps: CheckpointQuizDeps & { bus: EngineBus },
    private readonly opts: CheckpointQuizOptions & { studiedExcerptChars: number },
  ) {}

  /** The generation request for a checkpoint, grounded in `chatExcerpt`. */
  request(roadmap: Roadmap, item: CheckpointItem, chatExcerpt: string): QuizRequest {
    return {
      roadmapId: roadmap.id,
      itemId: item.id,
      studied: studiedText(roadmap, item, chatExcerpt, this.opts.studiedExcerptChars),
      language: languageOf(this.deps.repos.profile.get()),
    }
  }

  /** Prefetches a checkpoint that is still open when it fires; `excerpt` is read at that time. */
  prefetchCheckpoint(roadmapId: Id, itemId: Id, excerpt: () => string, delayMs: number): void {
    const build = () => {
      const roadmap = this.deps.repos.roadmaps.get(roadmapId)
      const item = this.item(roadmap, itemId)
      const closed = item?.status === 'done' || item?.status === 'skipped'
      if (!roadmap || roadmap.status === 'done' || !item || closed) return null
      return this.request(roadmap, item, excerpt())
    }
    this.prefetch(itemId, build, delayMs)
  }

  /**
   * Generates the item's quiz in the background, now or after `delayMs` (so the chat has time to
   * show the AI's answer). `build` runs when it fires; null skips. Failures are retried by ensure.
   */
  prefetch(itemId: Id, build: () => QuizRequest | null, delayMs = 0): void {
    this.timers.get(itemId)?.()
    const run = () => {
      this.timers.delete(itemId)
      const req = build()
      if (!req || this.stored(req.roadmapId, req.itemId) || this.inFlight.has(req.itemId)) return
      this.generate(req).catch((error) => console.warn('[study] checkpoint prefetch failed', error))
    }
    if (delayMs <= 0) run()
    else this.timers.set(itemId, this.deps.clock.setTimeout(run, delayMs))
  }

  /** Drops scheduled (not yet started) prefetches. */
  cancelScheduled(): void {
    for (const cancel of this.timers.values()) cancel()
    this.timers.clear()
  }

  async ensure(req: QuizRequest): Promise<Quiz> {
    this.timers.get(req.itemId)?.()
    this.timers.delete(req.itemId)
    const existing = this.stored(req.roadmapId, req.itemId)
    if (existing) return existing
    const pending = this.inFlight.get(req.itemId)
    if (pending) {
      try {
        return await pending
      } catch {
        // The prefetch failed: try once more on demand below.
      }
      const linked = this.stored(req.roadmapId, req.itemId)
      if (linked) return linked
    }
    return this.generate(req)
  }

  /** The quiz already linked to the item, if it is still usable. */
  stored(roadmapId: Id, itemId: Id): Quiz | null {
    const item = this.item(this.deps.repos.roadmaps.get(roadmapId), itemId)
    if (!item?.quizId) return null
    const quiz = this.deps.repos.quizzes.get(item.quizId)
    return quiz && quiz.status !== 'failed' ? quiz : null
  }

  /** Counts a failed generation for the item and returns the running total. */
  recordFailure(itemId: Id): number {
    const n = (this.failures.get(itemId) ?? 0) + 1
    this.failures.set(itemId, n)
    return n
  }

  clearFailures(itemId: Id): void {
    this.failures.delete(itemId)
  }

  private item(roadmap: Roadmap | null, itemId: Id): CheckpointItem | null {
    const item = roadmap?.items.find((i) => i.id === itemId)
    return isCheckpoint(item) ? item : null
  }

  private generate(req: QuizRequest): Promise<Quiz> {
    const { repos, clock, bus } = this.deps
    const roadmap = repos.roadmaps.get(req.roadmapId)
    const item = this.item(roadmap, req.itemId)
    if (!roadmap || !item) return Promise.reject(new Error(`checkpoint ${req.itemId} not found`))
    const job = buildCheckpointQuiz(
      this.deps,
      { roadmap, item, studied: req.studied, language: req.language, nowIso: clock.nowIso() },
      this.opts,
    ).then((quiz) => {
      // Link against the freshest roadmap: the student may have moved on while we waited.
      const fresh = repos.roadmaps.get(req.roadmapId)
      const freshItem = this.item(fresh, req.itemId)
      if (!fresh || !freshItem) throw new Error(`checkpoint ${req.itemId} disappeared`)
      const already = this.stored(req.roadmapId, req.itemId)
      if (already) return already
      repos.transaction(() => {
        repos.quizzes.save(quiz)
        // Linking is bookkeeping, not progress: keep updatedAt so a parked roadmap stays older.
        repos.roadmaps.save(withItem(fresh, { ...freshItem, quizId: quiz.id }, fresh.updatedAt))
      })
      bus.emit('memory:changed', { scope: 'quizzes', ids: [quiz.id] })
      return quiz
    })
    this.inFlight.set(req.itemId, job)
    const clear = () => {
      if (this.inFlight.get(req.itemId) === job) this.inFlight.delete(req.itemId)
    }
    job.then(clear, clear)
    return job
  }
}
