/**
 * Dependencies and tunables of the study lane (StudyService + PromptService).
 *
 * Everything is constructor-injected so tests run on FakeClock, FakeBrain and memory repos.
 */
import type { Id } from '@shared/domain'
import type { SessionState } from '@shared/state'
import type { Brain } from '../../brain-contract'
import type { Clock } from '../../clock'
import type { MasteryModel, Repos } from '../../contracts'
import type { EngineBus } from '../../events'

/** The part of FollowUpService (lane L5) the study session needs. */
export interface SessionCompleteHook {
  onSessionComplete(roadmapId: Id): void
}

export interface StudyOptions {
  /** P4 step writer deadline; on timeout the item's prompt draft is pasted instead. */
  writeStepTimeoutMs: number
  roadmapTimeoutMs: number
  checkpointTimeoutMs: number
  verifyTimeoutMs: number
  /** Regeneration attempts per mismatching checkpoint question before it is dropped. */
  maxRegenerateTries: number
  /** Failed quiz generations for one checkpoint before it is skipped (its misses stay carried). */
  maxCheckpointFailures: number
  /**
   * With a live `chatExcerpt` provider, the checkpoint after a step is generated this long after
   * the step was pasted, so the quiz sees the AI's answer (D11). Without one it starts at once.
   */
  prefetchDelayMs: number
  /** Assistant name used when no AI chat is known. */
  defaultAssistant: string
  /** Characters of the chat excerpt handed to the step writer (newest end). */
  stepExcerptChars: number
  /** Characters of the chat excerpt handed to the quizmaster as "studied". */
  studiedExcerptChars: number
  /**
   * A learn step is done only once the AI's answer to its prompt is in the chat (Ilari,
   * 2026-10-25). Off in tests that walk a roadmap without a chat feed.
   */
  requireAnswer: boolean
}

export const DEFAULT_STUDY_OPTIONS: StudyOptions = {
  writeStepTimeoutMs: 2500,
  roadmapTimeoutMs: 30_000,
  checkpointTimeoutMs: 25_000,
  verifyTimeoutMs: 15_000,
  maxRegenerateTries: 2,
  maxCheckpointFailures: 2,
  prefetchDelayMs: 20_000,
  defaultAssistant: 'ChatGPT',
  stepExcerptChars: 1500,
  studiedExcerptChars: 4000,
  requireAnswer: true,
}

export interface StudyDeps {
  repos: Repos
  brain: Brain
  clock: Clock
  bus: EngineBus
  mastery: MasteryModel
  /** Called once when a roadmap is completed (lane L5 schedules the follow-up review). */
  followUp?: SessionCompleteHook | null
  /** Live AI-chat text, newest last (PerceptionService.chatExcerpt), for delayed prefetches. */
  chatExcerpt?: ((maxChars: number) => string) | null
  options?: Partial<StudyOptions>
}

export interface PromptOptions {
  /** Suggest/improve are `write`-tier calls: same 2.5 s budget as the step writer. */
  timeoutMs: number
  defaultAssistant: string
  contextChars: number
}

export const DEFAULT_PROMPT_OPTIONS: PromptOptions = {
  timeoutMs: 2500,
  defaultAssistant: 'ChatGPT',
  contextChars: 600,
}

export interface PromptDeps {
  repos: Repos
  brain: Brain
  clock: Clock
  /** The running study session, if any (its next step is the top suggestion). */
  session?: (() => SessionState | null) | null
  options?: Partial<PromptOptions>
}
