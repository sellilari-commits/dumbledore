/**
 * Lane L2b public surface: `createBrain` (the real Brain) plus the pieces the shell and Settings
 * need — key lookup, route resolution and the student-prompt rule checker.
 */
export { type BrainDeps, type BrainHandle, createBrain } from './brain'
export { createMemoryCache, type ResponseCache } from './llm/cache'
export { createKeyGetter, type KeyGetter, type KeyName } from './llm/keys'
export { EXTRA_FALLBACKS, parseRouteList, resolveRoutes } from './llm/routes'
export { DEFAULT_TIMEOUTS } from './llm/structured'
export type { Backend, BackendRequest, BackendResult } from './llm/types'
export { checkStudentPrompt } from './prompts/shared'
