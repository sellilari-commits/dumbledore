/**
 * Thin adapters between the real lanes and the shell's contracts, for the few places where they
 * don't fit as-is (each one is listed as a request in docs/progress/I0-real-engine.md):
 *
 * - `withoutSessionEcho`: the real StudyService already emits 'session:changed' on the bus, so
 *   compose.ts's `bridgeEvents` must not forward `study.onChange` a second time.
 * - `oncePerRoadmap`: both StudyService (on the 'done' transition) and the shell's SessionFlow
 *   (on the 'complete' instruction) report a finished roadmap; the follow-up is scheduled once.
 * - `withoutNudgeToasts`: the nudge engine announces each nudge as 'nudge:ready' and again as a
 *   'toast:show'; the shell's overlay turns both into a toast, so the follow-up service gets a
 *   bus view that drops the duplicate (the overlay's own nudge toast has the snooze action).
 * - `helperSignals`: FollowUpService's receptivity signals (idle time, frontmost window) read
 *   from the helper.
 * - `keysWithSecrets`: API keys from the shell's SecretStore first, then the env/.env lookup.
 */
import type { KeyGetter, KeyName } from '@engine/brain'
import type { FollowUpService, HelperClient, StudyService } from '@engine/contracts'
import type { EngineBus, EngineEvents } from '@engine/events'
import type { ReceptivitySignals } from '@engine/scheduler/receptivity'
import type { Id } from '@shared/domain'
import type { SecretKey, SecretStore } from '../services'

/** The same service, minus `onChange` (for `bridgeEvents` only). */
export function withoutSessionEcho(study: StudyService): StudyService {
  return {
    current: () => study.current(),
    picker: () => study.picker(),
    start: (input, ctx) => study.start(input, ctx),
    next: (ctx) => study.next(ctx),
    pasteFailed: (itemId) => study.pasteFailed(itemId),
    skipCheckpoint: (itemId, ctx) => study.skipCheckpoint(itemId, ctx),
    pause: () => study.pause(),
    end: () => study.end(),
    onChange: () => () => {},
  }
}

/** Forwards `onSessionComplete` once per roadmap; everything else passes through. */
export function oncePerRoadmap(inner: FollowUpService): FollowUpService {
  const reported = new Set<Id>()
  return {
    start: () => inner.start(),
    stop: () => inner.stop(),
    dueSummary: () => inner.dueSummary(),
    onSessionComplete(roadmapId) {
      if (reported.has(roadmapId)) return
      reported.add(roadmapId)
      inner.onSessionComplete(roadmapId)
    },
  }
}

/** The same bus, minus 'toast:show' events that only repeat a nudge. */
export function withoutNudgeToasts(bus: EngineBus): EngineBus {
  const view: Pick<EngineBus, 'on' | 'once' | 'emit' | 'listenerCount'> = {
    on: (event, listener) => bus.on(event, listener),
    once: (event, listener) => bus.once(event, listener),
    emit: (event, payload) => {
      if (event === 'toast:show' && (payload as EngineEvents['toast:show']).toast.nudgeId) return
      bus.emit(event, payload)
    },
    listenerCount: (event) => bus.listenerCount(event),
  }
  return view as EngineBus
}

/** Idle seconds and the frontmost window from the helper; failures reject (= "no signal"). */
export function helperSignals(helper: HelperClient, timeoutMs = 1500): ReceptivitySignals {
  return {
    idleSeconds: async () => (await helper.call('system.idle', {}, { timeoutMs })).seconds,
    frontmost: () => helper.call('frontmost', {}, { timeoutMs }),
  }
}

const SECRET_OF: Partial<Record<KeyName, SecretKey>> = {
  GEMINI_API_KEY: 'gemini',
  GROQ_API_KEY: 'groq',
  MISTRAL_API_KEY: 'mistral',
}

/** Keys typed into Settings win; otherwise the brain's env / .env.local / env-files lookup. */
export function keysWithSecrets(secrets: SecretStore | null, fallback: KeyGetter): KeyGetter {
  return (name) => {
    const secret = SECRET_OF[name]
    const stored = secret && secrets ? secrets.get(secret)?.trim() : undefined
    return stored ? stored : fallback(name)
  }
}
