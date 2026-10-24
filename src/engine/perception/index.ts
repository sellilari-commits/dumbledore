/**
 * Perception (lane L3): screen → episodes → prefilter → extraction → memory (docs/PLAN.md §6.4).
 * Start with `createPerceptionStack`; the pieces are exported for tests and the integrator.
 */
export {
  ASSISTANTS,
  type AssistantConfig,
  assistantByKey,
  chatInputPlaceholders,
  GENERIC_CHAT_MARKERS,
} from './ai-chat/assistants'
export { type AssistantMatch, detectAssistant } from './ai-chat/detector'
export { AiChatTracker } from './ai-chat/tracker'
export { CADENCE, type CaptureMode, cadenceFor } from './cadence'
export { EPISODE_DEFAULTS, EpisodeBuilder, type EpisodeOptions } from './episodes/builder'
export { parseSearchQuery } from './episodes/signals'
export { type ApplyOutcome, applyExtraction } from './extraction/apply'
export { DailyBudget } from './extraction/budget'
export { PREFILTER_DEFAULTS, type PrefilterResult, prefilter } from './extraction/prefilter'
export { ExtractionWorker, WORKER_DEFAULTS, type WorkerOptions } from './extraction/worker'
export { CaptureScheduler, type PauseReason, type PerceiveBatch } from './scheduler'
export { Perception, type PerceptionDeps } from './service'
export { createPerceptionStack, type PerceptionStack, type PerceptionStackDeps } from './stack'
