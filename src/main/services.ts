/**
 * The service bundle the shell runs on.
 *
 * Every engine dependency the main process uses is listed here and injected by the composition
 * root (compose.ts). Lanes swap fakes for real implementations there; nothing else in src/main
 * constructs a service.
 */
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type {
  FollowUpService,
  HelperClient,
  PerceptionService,
  PromptService,
  QueryService,
  QuizService,
  Repos,
  StudyService,
  SubjectService,
} from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { ProviderId } from '@shared/llm'

export type SecretKey = 'gemini' | 'groq' | 'mistral'

/** API keys, encrypted at rest (Electron safeStorage in production). Values never cross IPC. */
export interface SecretStore {
  set(key: SecretKey, value: string): void
  get(key: SecretKey): string | null
  has(key: SecretKey): boolean
}

export interface ProviderTestResult {
  ok: boolean
  latencyMs: number | null
  error: string | null
}

/** LLM provider health as the Settings page and AppState show it. */
export interface ProviderService {
  test(id: ProviderId): Promise<ProviderTestResult>
  status(): { ready: boolean; onDevice: boolean; providers: { id: string; ok: boolean }[] }
}

export interface Services {
  clock: Clock
  bus: EngineBus
  repos: Repos
  brain: Brain
  helper: HelperClient
  study: StudyService
  prompts: PromptService
  quizzes: QuizService
  queries: QueryService
  subjects: SubjectService
  perception: PerceptionService
  followUps: FollowUpService
  secrets: SecretStore
  providers: ProviderService
  /** Starts background work (helper connection, perception, follow-ups). */
  start(): Promise<void>
  stop(): Promise<void>
}
