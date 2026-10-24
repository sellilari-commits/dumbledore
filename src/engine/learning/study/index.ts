/**
 * Lane L4 — study sessions inside AI chats and prompt suggestions (PLAN F2/F3/F5, §6.6).
 * Public surface for the integrator; everything else in this folder is internal.
 */
export {
  DEFAULT_PROMPT_OPTIONS,
  DEFAULT_STUDY_OPTIONS,
  type PromptDeps,
  type PromptOptions,
  type SessionCompleteHook,
  type StudyDeps,
  type StudyOptions,
} from './deps'
export { buildPicker, summarizeSubject } from './picker'
export { createPromptService, PromptServiceImpl } from './prompt-service'
export { StudyError } from './session-state'
export { createStudyService, StudyServiceImpl } from './study-service'
