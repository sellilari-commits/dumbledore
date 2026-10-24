/**
 * FollowUpService (engine/contracts.ts): the scheduler loop behind F8 "follow up at a suitable
 * time". Every 5 minutes, when a natural break opens, when a snooze ends and 30 min after a
 * finished study session it runs one check: expire stale nudges, ramp up reviews before near
 * deadlines, rebuild the learner profile once a day, sample receptivity and let the nudge engine
 * decide. Also answers "what is due" and records nudge answers (accept / dismiss / snooze).
 */
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { FollowUpService, Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { createMasteryModel, type MasteryService } from '@engine/learning/mastery/mastery-model'
import { type LocalTime, MINUTE_MS, systemLocalTime } from '@engine/scheduler/local-time'
import { gatherCandidates } from '@engine/scheduler/nudge-candidates'
import { FOLLOW_UP_WINDOW, type FollowUp } from '@engine/scheduler/nudge-common'
import {
  createNudgeEngine,
  type NudgeAction,
  type NudgeActResult,
  type NudgeEngine,
} from '@engine/scheduler/nudge-engine'
import { createProfileBuilder, type ProfileBuilder } from '@engine/scheduler/profile-builder'
import {
  createReceptivityDetector,
  type ReceptivityDetector,
  type ReceptivitySignals,
} from '@engine/scheduler/receptivity'
import type { Id, Nudge } from '@shared/domain'

export const CHECK_EVERY_MS = 5 * MINUTE_MS
/** A natural break triggers a check this soon (lets the moment settle). */
export const BREAK_CHECK_DELAY_MS = 5_000

export interface FollowUpDeps {
  repos: Repos
  brain: Brain
  bus: EngineBus
  clock: Clock
  /** Helper-backed signals: idle seconds and the frontmost window. */
  signals: ReceptivitySignals
  mastery?: MasteryService
  localTime?: LocalTime
  checkEveryMs?: number
  log?: (message: string, error?: unknown) => void
}

export interface FollowUpRuntime extends FollowUpService {
  /** IPC 'nudge.act': records the answer; run `action` when it is not null. */
  act(nudgeId: Id, action: NudgeAction): NudgeActResult
  /** One evaluation now; resolves with the nudge shown, if any. */
  check(reason?: string): Promise<Nudge | null>
  /** Resolves when in-flight checks and profile builds are done (tests, shutdown). */
  settled(): Promise<void>
  readonly receptivity: ReceptivityDetector
  readonly profile: ProfileBuilder
  readonly nudges: NudgeEngine
}

export function createFollowUpService(deps: FollowUpDeps): FollowUpRuntime {
  const { repos, brain, bus, clock } = deps
  const lt = deps.localTime ?? systemLocalTime
  const log = deps.log ?? ((m: string, e?: unknown) => console.warn(`[follow-up] ${m}`, e ?? ''))
  const mastery = deps.mastery ?? createMasteryModel({ repos, localTime: lt })
  const receptivity = createReceptivityDetector({
    bus,
    clock,
    signals: deps.signals,
    settings: () => repos.settings.get(),
    localTime: lt,
  })
  const nudges = createNudgeEngine({ repos, brain, bus, clock, localTime: lt, log })
  const profile = createProfileBuilder({ repos, brain, bus, clock, localTime: lt, log })
  const followUps = new Map<Id, number>()
  const jobs = new Set<Promise<unknown>>()
  const stops: (() => void)[] = []
  let soon: (() => void) | null = null
  let running: Promise<Nudge | null> | null = null

  function track<T>(job: Promise<T>): Promise<T> {
    jobs.add(job)
    void job.catch(() => {}).finally(() => jobs.delete(job))
    return job
  }

  function pruneFollowUps(nowMs: number): void {
    for (const [id, at] of followUps) if (nowMs >= at + FOLLOW_UP_WINDOW.toMs) followUps.delete(id)
  }

  async function evaluate(): Promise<Nudge | null> {
    const nowMs = clock.now()
    nudges.expireStale(nowMs)
    pruneFollowUps(nowMs)
    const ramped = mastery.rampForDeadlines(nowMs)
    if (ramped.length > 0) bus.emit('memory:changed', { scope: 'concepts', ids: ramped })
    track(profile.maybeBuild(nowMs))
    await receptivity.refresh()
    const at = clock.now()
    const state = receptivity.evaluate(at)
    const shown = await nudges.run({
      nowMs: at,
      receptivity: state,
      candidates: () =>
        gatherCandidates({
          repos,
          nowMs: at,
          lt,
          settings: repos.settings.get(),
          followUps: [...followUps].map(
            ([roadmapId, completedAt]): FollowUp => ({ roadmapId, completedAt }),
          ),
          habitsToCoach: profile.habitsToCoach(),
        }),
    })
    return shown
  }

  function check(reason = 'manual'): Promise<Nudge | null> {
    running ??= track(
      evaluate()
        .catch((error: unknown) => {
          log(`check (${reason}) failed`, error)
          return null
        })
        .finally(() => {
          running = null
        }),
    )
    return running
  }

  function checkSoon(reason: string): void {
    if (soon) return
    soon = clock.setTimeout(() => {
      soon = null
      void check(reason)
    }, BREAK_CHECK_DELAY_MS)
  }

  /** Roadmaps finished in the last hour (e.g. before a restart) still get their follow-up. */
  function recoverFollowUps(nowMs: number): void {
    for (const subject of repos.subjects.list()) {
      for (const roadmap of repos.roadmaps.listBySubject(subject.id)) {
        const doneAt = Date.parse(roadmap.updatedAt)
        if (roadmap.status !== 'done' || Number.isNaN(doneAt) || followUps.has(roadmap.id)) continue
        if (nowMs - doneAt >= FOLLOW_UP_WINDOW.toMs || doneAt > nowMs) continue
        followUps.set(roadmap.id, doneAt)
        receptivity.noteSessionComplete(doneAt)
      }
    }
  }

  return {
    receptivity,
    profile,
    nudges,
    check,
    act: (nudgeId, action) => nudges.act(nudgeId, action),

    start() {
      if (stops.length > 0) return
      receptivity.start()
      recoverFollowUps(clock.now())
      stops.push(
        () => receptivity.stop(),
        () => nudges.dispose(),
        clock.setInterval(() => void check('tick'), deps.checkEveryMs ?? CHECK_EVERY_MS),
        receptivity.onBreak((kind) => checkSoon(`break:${kind}`)),
        nudges.onSnoozeEnd(() => checkSoon('snooze')),
      )
      checkSoon('start')
    },

    stop() {
      for (const stop of stops.splice(0)) stop()
      soon?.()
      soon = null
    },

    onSessionComplete(roadmapId) {
      const nowMs = clock.now()
      followUps.set(roadmapId, nowMs)
      receptivity.noteSessionComplete(nowMs) // opens the 30–60 min break, which triggers a check
    },

    dueSummary() {
      const archived = new Set(repos.subjects.list({ status: ['archived'] }).map((s) => s.id))
      const due = repos.concepts
        .listDue(clock.nowIso(), 500)
        .filter((c) => !archived.has(c.subjectId))
      return { count: due.length, conceptIds: due.map((c) => c.id) }
    },

    async settled() {
      while (jobs.size > 0) await Promise.allSettled([...jobs])
    },
  }
}
