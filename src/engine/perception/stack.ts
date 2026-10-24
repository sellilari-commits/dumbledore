/**
 * One-call wiring of perception + the extraction worker for the shell/integrator:
 * screen → episodes → prefilter → Brain.extract → memory, with subjects fed back into "Right now".
 */
import type { Brain } from '../brain-contract'
import { systemClock } from '../clock'
import type { MasteryModel } from '../contracts'
import { ExtractionWorker, type WorkerOptions } from './extraction/worker'
import { Perception, type PerceptionDeps } from './service'

export interface PerceptionStackDeps extends PerceptionDeps {
  brain: Pick<Brain, 'extract' | 'triage'>
  mastery?: MasteryModel | null
  workerOptions?: Partial<WorkerOptions>
}

export interface PerceptionStack {
  perception: Perception
  worker: ExtractionWorker
  start(): void
  stop(): void
}

export function createPerceptionStack(deps: PerceptionStackDeps): PerceptionStack {
  const clock = deps.clock ?? systemClock
  const perception = new Perception({ ...deps, clock })
  const worker = new ExtractionWorker({
    repos: deps.repos,
    brain: deps.brain,
    bus: deps.bus,
    clock,
    mastery: deps.mastery,
    log: deps.log,
    options: deps.workerOptions,
    onEpisodeSubject: (episodeId, subjectId) => perception.linkSubject(episodeId, subjectId),
  })
  return {
    perception,
    worker,
    start() {
      worker.start()
      perception.start()
    },
    stop() {
      perception.stop() // closes open episodes first, so the worker still sees them
      worker.stop()
    },
  }
}
