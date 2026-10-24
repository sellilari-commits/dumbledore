/**
 * composeReal(): the production composition root. Returns the same `Composition` as compose.ts,
 * but every service is a real lane implementation: SQLite store in the data folder, the Brain
 * (with its spend cap read from the persistent usage log), the Swift helper over its socket,
 * perception + extraction worker, study + prompts + quizzes + mastery + follow-ups, read models,
 * subjects + the Markdown memory mirror, and provider tests through the brain.
 *
 * Running the real engine in development:
 *   1. `npm run helper:build` — builds native/helper/build/dumbledore-helper (dev launch mode);
 *      or run the helper yourself and set DUMBLEDORE_HELPER=external.
 *   2. Keys: GEMINI_API_KEY (and optional fallbacks) in .env.local, or point
 *      DUMBLEDORE_ENV_FILES at an existing env file (see .env.example). Settings → AI keys win.
 *   3. Optional: DUMBLEDORE_DATA_DIR=<scratch folder> to keep your real data out of it;
 *      DUMBLEDORE_BUDGET_EUR=<n> to lower the Gemini spend cap (default €10).
 *   4. `npm run dev` (the shell uses composeReal unless DUMBLEDORE_FAKES=1). better-sqlite3's
 *      Node-API prebuild loads in Electron 45 as is (checked); keep it external in the bundle.
 */
import { type BrainDeps, type BrainHandle, createBrain, createKeyGetter } from '@engine/brain'
import { capFromEnv } from '@engine/brain/llm/spend'
import type { Brain } from '@engine/brain-contract'
import { systemClock } from '@engine/clock'
import { createEngineBus } from '@engine/events'
import { createFollowUpService } from '@engine/learning/followup/followup-service'
import { createMasteryModel } from '@engine/learning/mastery'
import { createQuizService } from '@engine/learning/quiz'
import { createPromptService, createStudyService } from '@engine/learning/study'
import { createPerceptionStack } from '@engine/perception'
import { redact } from '@engine/privacy'
import { createQueryService } from '@engine/queries'
import { createSqliteRepos, ensureDataDirs, resolveDataPaths } from '@engine/store'
import { createMemoryMirror, createSubjectService, type MemoryMirrorHandle } from '@engine/subjects'
import { bridgeEvents } from '../compose'
import type { Services } from '../services'
import {
  helperSignals,
  keysWithSecrets,
  oncePerRoadmap,
  withoutNudgeToasts,
  withoutSessionEcho,
} from './adapters'
import { createRealHelper, launchFromEnv, startWithin } from './helper-launch'
import { Lifecycle } from './lifecycle'
import { memorySecrets } from './memory-secrets'
import { RealProviderService } from './providers'
import type { RealComposeOptions, RealComposition } from './types'

export type { RealComposeOptions, RealComposition, RealEngine } from './types'

const HELPER_WAIT_MS = 2000

export function composeReal(opts: RealComposeOptions = {}): RealComposition {
  const clock = opts.clock ?? systemClock
  const env = opts.env ?? process.env
  const log = opts.log ?? ((message: string, error?: unknown) => console.warn(message, error ?? ''))
  const paths = ensureDataDirs(resolveDataPaths({ root: opts.dataDir, env }))
  const repos = createSqliteRepos(paths.dbFile, clock)
  const bus = createEngineBus()
  const secrets = opts.secrets ?? memorySecrets()
  const keys = keysWithSecrets(secrets, opts.keys ?? createKeyGetter({ env }))
  const helper =
    opts.helper ??
    createRealHelper(
      opts.launch ?? launchFromEnv(env, process.cwd()),
      paths.helperSocket,
      (level, message) => {
        if (level !== 'debug') log(`[helper] ${message}`)
      },
    )

  const brainDeps: BrainDeps = {
    clock,
    usage: repos.usage, // persistent: budgets and the spend cap survive restarts
    helper,
    keys,
    redact: (text) => (repos.settings.get().privacy.redact ? redact(text) : text),
    settings: () => repos.settings.get(),
    spendCapEur: opts.spendCapEur ?? capFromEnv(env),
    ...opts.brainDeps,
  }
  const handle = opts.brain ? null : createBrain(brainDeps)
  const brain: Brain = opts.brain ?? (handle as BrainHandle)

  const mastery = createMasteryModel({ repos })
  const stack = createPerceptionStack({
    helper,
    repos,
    bus,
    clock,
    brain,
    mastery,
    isLowPower: opts.isLowPower,
    log,
    workerOptions: opts.tuning?.worker,
  })
  const { perception } = stack
  const followUps = createFollowUpService({
    repos,
    brain,
    bus: withoutNudgeToasts(bus),
    clock,
    signals: helperSignals(helper),
    mastery,
    checkEveryMs: opts.tuning?.followUpCheckEveryMs,
    log,
  })
  const followUp = oncePerRoadmap(followUps)
  const study = createStudyService({
    repos,
    brain,
    clock,
    bus,
    mastery,
    followUp,
    chatExcerpt: (n) => perception.chatExcerpt(n),
    options: opts.tuning?.study,
  })
  const quizzes = createQuizService({
    repos,
    brain,
    bus,
    clock,
    mastery,
    assistantName: () => perception.aiChat()?.assistant ?? study.current()?.assistant ?? null,
    log,
  })
  quizzes.setCheckpointHandler((quizId, result) => study.handleCheckpointResult(quizId, result))
  const prompts = createPromptService({ repos, brain, clock, session: () => study.current() })
  const providers = new RealProviderService({
    clock,
    keys,
    helper,
    settings: () => repos.settings.get(),
    probe: (route) =>
      opts.brain ?? createBrain({ ...brainDeps, routes: () => [route], cache: null }),
  })

  let mirror: MemoryMirrorHandle | null = null
  const offs: (() => void)[] = []
  const lifecycle = new Lifecycle(
    [
      {
        name: 'events',
        start: () => {
          offs.push(
            bridgeEvents(helper, withoutSessionEcho(study), bus),
            helper.onStatus((status) => {
              if (status === 'connected') void providers.refreshOnDevice()
            }),
          )
        },
        stop: () => {
          for (const off of offs.splice(0)) off()
        },
      },
      {
        name: 'memory mirror',
        start: () => {
          mirror ??= createMemoryMirror({
            repos,
            clock,
            dir: paths.memoryDir,
            bus,
            debounceMs: opts.tuning?.memoryDebounceMs,
            onError: (error) => log('[memory-mirror] write failed', error),
          })
          mirror.regenerateAll()
        },
        stop: () => {
          mirror?.flush()
          mirror?.dispose()
          mirror = null
        },
      },
      { name: 'quiz recovery', start: () => void quizzes.recoverInterrupted(), stop: () => {} },
      {
        name: 'helper',
        start: () => startWithin(helper.start(), opts.tuning?.helperWaitMs ?? HELPER_WAIT_MS),
        stop: () => helper.stop(),
      },
      {
        name: 'perception',
        start: () => {
          perception.setEnabled(repos.settings.get().captureEnabled)
          stack.start()
        },
        stop: () => stack.stop(),
      },
      { name: 'follow-ups', start: () => followUps.start(), stop: () => followUps.stop() },
    ],
    log,
  )

  const services: Services = {
    clock,
    bus,
    repos,
    brain,
    helper,
    study,
    prompts,
    quizzes,
    queries: createQueryService({ repos, clock }),
    subjects: createSubjectService({ repos, bus }),
    perception,
    followUps: followUp,
    secrets,
    providers,
    start: () => lifecycle.start(),
    stop: () => lifecycle.stop(),
  }

  const settled = async () => {
    await Promise.all([quizzes.settled(), followUps.settled()])
  }
  let closing: Promise<void> | null = null
  return {
    services,
    fakes: { helper: null, perception: null },
    engine: {
      paths,
      repos,
      brain: handle,
      perception,
      worker: stack.worker,
      study,
      quizzes,
      mastery,
      followUps,
      providers,
      mirror: () => mirror,
    },
    settled,
    close() {
      closing ??= (async () => {
        await lifecycle.stop()
        await settled()
        repos.close()
      })()
      return closing
    },
  }
}
