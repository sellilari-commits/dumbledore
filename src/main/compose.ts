/**
 * Composition root: builds every service the shell uses and wires engine events.
 *
 * Today everything is a fake (memory repos, FakeBrain, src/main/fakes). Integration swaps the
 * real lanes in here — nothing else in src/main constructs a service. `fakes` exposes the fake
 * helper and perception so the test-control channel can drive them.
 */
import type { Brain } from '@engine/brain-contract'
import { type Clock, systemClock } from '@engine/clock'
import type { HelperClient, StudyService } from '@engine/contracts'
import { createEngineBus, type EngineBus } from '@engine/events'
import { FakeBrain } from '@engine/testing/fake-brain'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { FakeHelperClient } from './fakes/fake-helper'
import { FakePerceptionService } from './fakes/fake-perception'
import { FakeQueryService } from './fakes/fake-queries'
import { FakeQuizService } from './fakes/fake-quiz'
import {
  FakeFollowUpService,
  FakePromptService,
  FakeProviderService,
  FakeSubjectService,
  MemorySecretStore,
} from './fakes/fake-services'
import { FakeStudyService } from './fakes/fake-study'
import { seedDemo } from './fakes/seed'
import type { SecretStore, Services } from './services'

export interface ComposeOptions {
  clock?: Clock
  /** Real helper client; defaults to the in-process fake. */
  helper?: HelperClient
  brain?: Brain
  secrets?: SecretStore
  /** Fill the in-memory store with demo subjects (default true). */
  seed?: boolean
  /** Dumbledore's own pid, so perception ignores our own windows. */
  ownPid?: number
}

export interface Composition {
  services: Services
  /** Present only while the corresponding fake is in use. */
  fakes: { helper: FakeHelperClient | null; perception: FakePerceptionService | null }
}

/** Forwards helper notifications and session changes onto the engine bus. */
export function bridgeEvents(
  helper: HelperClient,
  study: StudyService,
  bus: EngineBus,
): () => void {
  const offs = [
    helper.on('focus.changed', (p) => bus.emit('helper:focus', p)),
    helper.on('app.activated', (p) => bus.emit('helper:appActivated', p)),
    helper.on('key.trigger', (p) => bus.emit('helper:key', p)),
    helper.on('screen.locked', () => bus.emit('helper:screenLocked', { locked: true })),
    helper.on('screen.unlocked', () => bus.emit('helper:screenLocked', { locked: false })),
    helper.on('display.changed', (p) => bus.emit('helper:displays', p)),
    helper.onStatus((status) => bus.emit('helper:status', { status })),
    study.onChange((session) => bus.emit('session:changed', { session })),
  ]
  return () => {
    for (const off of offs) off()
  }
}

export function compose(opts: ComposeOptions = {}): Composition {
  const clock = opts.clock ?? systemClock
  const bus = createEngineBus()
  const repos = createMemoryRepos(clock)
  if (opts.seed ?? true) seedDemo(repos, clock)
  const brain = opts.brain ?? new FakeBrain()
  const fakeHelper = opts.helper ? null : new FakeHelperClient()
  const helper: HelperClient = opts.helper ?? (fakeHelper as FakeHelperClient)
  const secrets = opts.secrets ?? new MemorySecretStore()

  const perception = new FakePerceptionService({ bus, clock, helper, ownPid: opts.ownPid })
  const queries = new FakeQueryService(repos, clock)
  const study = new FakeStudyService({ brain, repos, clock, queries })
  const quizzes = new FakeQuizService({
    brain,
    repos,
    clock,
    bus,
    onFinished: (quiz) => study.onQuizFinished(quiz),
  })
  const prompts = new FakePromptService({ brain, repos, clock, study })
  const subjects = new FakeSubjectService(repos)
  const followUps = new FakeFollowUpService({ repos, clock, bus })
  const providers = new FakeProviderService(secrets)

  let unbridge: (() => void) | null = null
  const services: Services = {
    clock,
    bus,
    repos,
    brain,
    helper,
    study,
    prompts,
    quizzes,
    queries,
    subjects,
    perception,
    followUps,
    secrets,
    providers,
    async start() {
      unbridge ??= bridgeEvents(helper, study, bus)
      perception.setEnabled(repos.settings.get().captureEnabled)
      perception.start()
      followUps.start()
      await helper.start()
    },
    async stop() {
      followUps.stop()
      perception.stop()
      unbridge?.()
      unbridge = null
      await helper.stop()
    },
  }
  return { services, fakes: { helper: fakeHelper, perception } }
}
