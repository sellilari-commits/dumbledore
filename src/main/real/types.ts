/**
 * Options and result of composeReal (compose-real.ts). `RealComposition` is a `Composition`
 * (what app.ts consumes today) plus the engine internals and a `close()` for a clean shutdown.
 */
import type { BrainDeps, BrainHandle, KeyGetter } from '@engine/brain'
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { HelperClient } from '@engine/contracts'
import type { FollowUpRuntime } from '@engine/learning/followup/followup-service'
import type { MasteryService } from '@engine/learning/mastery'
import type { QuizServiceImpl } from '@engine/learning/quiz'
import type { StudyOptions, StudyServiceImpl } from '@engine/learning/study'
import type { PerceptionStack, WorkerOptions } from '@engine/perception'
import type { DataPaths, SqliteRepos } from '@engine/store'
import type { MemoryMirrorHandle } from '@engine/subjects'
import type { Composition } from '../compose'
import type { SecretStore } from '../services'
import type { HelperLaunch } from './helper-launch'
import type { RealProviderService } from './providers'

export interface RealComposeOptions {
  clock?: Clock
  /** Data folder; default DUMBLEDORE_DATA_DIR, else ~/Library/Application Support/Dumbledore. */
  dataDir?: string
  env?: Record<string, string | undefined>
  /** Injected helper (tests: a fake). Default: SocketHelperClient started per `launch`. */
  helper?: HelperClient
  /** How to start the helper when none is injected; default from DUMBLEDORE_HELPER / cwd. */
  launch?: HelperLaunch
  /** Injected brain (tests: FakeBrain). Default: createBrain wired to the store. */
  brain?: Brain
  /** Extra createBrain deps (tests: fake backends; never the network). */
  brainDeps?: Partial<BrainDeps>
  /** The shell's encrypted key store; default in-memory. */
  secrets?: SecretStore
  /** Key lookup behind the SecretStore; default env → .env.local → DUMBLEDORE_ENV_FILES. */
  keys?: KeyGetter
  /** Lifetime Gemini spend cap in EUR; default DUMBLEDORE_BUDGET_EUR (from `env`) or 10. */
  spendCapEur?: number
  isLowPower?: () => boolean
  log?: (message: string, error?: unknown) => void
  tuning?: {
    study?: Partial<StudyOptions>
    worker?: Partial<WorkerOptions>
    memoryDebounceMs?: number
    followUpCheckEveryMs?: number
    /** Longest start() waits for the helper's first connection attempt (real ms). */
    helperWaitMs?: number
  }
}

/** Engine internals the shell may want later (nudge answers, spend) and tests use. */
export interface RealEngine {
  paths: DataPaths
  repos: SqliteRepos
  /** The real brain, or null when one was injected. */
  brain: BrainHandle | null
  perception: PerceptionStack['perception']
  worker: PerceptionStack['worker']
  study: StudyServiceImpl
  quizzes: QuizServiceImpl
  mastery: MasteryService
  followUps: FollowUpRuntime
  providers: RealProviderService
  /** The Markdown memory mirror while started. */
  mirror(): MemoryMirrorHandle | null
}

export interface RealComposition extends Composition {
  engine: RealEngine
  /** Resolves when background work (exam generation, follow-up checks) is done. */
  settled(): Promise<void>
  /** stop(), settled(), then closes the database; the composition can't start again. */
  close(): Promise<void>
}
