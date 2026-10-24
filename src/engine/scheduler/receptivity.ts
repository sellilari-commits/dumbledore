/**
 * Natural-break detector (PLAN §6.6 nudge policy): is now a good moment to speak up?
 *
 * Inputs are injected signals — helper idle seconds and the frontmost window, polled — plus bus
 * events: app switches, focus changes, screen lock, perception's "now". The answer lists the
 * blockers (typing, full screen, meeting, quiet hours, away/locked, no signal) and the natural
 * breaks that are open: back from ≥ 2 min idle, switched away after a stint of work, first
 * activity of the day, 30–60 min after a finished study session. Without a break or with any
 * blocker, receptivity is 0.
 */
import type { Clock } from '@engine/clock'
import type { EngineBus } from '@engine/events'
import type { Settings } from '@shared/domain'
import type { FocusedElement, FrontmostInfo } from '@shared/helper-protocol'
import { isLeisureApp, isMeetingApp, isMeetingPage, isTransientApp } from './app-classes'
import { inQuietHours, type LocalTime, MINUTE_MS, systemLocalTime } from './local-time'

export type BreakKind = 'returned' | 'switchedAway' | 'firstActivity' | 'afterSession'
export type Blocker =
  | 'typing'
  | 'fullScreen'
  | 'meeting'
  | 'quietHours'
  | 'locked'
  | 'away'
  | 'noSignal'

export interface Receptivity {
  receptive: boolean
  score: number // 0..1
  blockers: Blocker[]
  breaks: BreakKind[]
}

export interface ReceptivitySignals {
  idleSeconds(): Promise<number>
  frontmost(): Promise<FrontmostInfo | null>
}

export interface ReceptivityDetector {
  start(): void
  stop(): void
  /** Samples idle time and the frontmost window now. */
  refresh(): Promise<void>
  evaluate(nowMs?: number): Receptivity
  isReceptive(nowMs?: number): boolean
  noteSessionComplete(atMs: number): void
  /** Called when a natural break opens (to run a nudge check right away). */
  onBreak(listener: (kind: BreakKind) => void): () => void
}

export interface ReceptivityOptions {
  bus: EngineBus
  clock: Clock
  signals: ReceptivitySignals
  settings: () => Settings
  localTime?: LocalTime
  pollMs?: number
}

export const AWAY_AFTER_S = 120
export const LONG_AWAY_S = 300
export const TYPING_IDLE_S = 15
export const FOCUS_SETTLE_MS = 10_000
export const MEETING_MEMORY_MS = 10 * MINUTE_MS
export const WORK_STINT_MS = 10 * MINUTE_MS
export const SIGNAL_STALE_MS = 2 * MINUTE_MS
export const AFTER_SESSION = { fromMs: 30 * MINUTE_MS, toMs: 60 * MINUTE_MS }
/** After a restart, the first sample only counts as "start of day" before this local time. */
export const FIRST_ACTIVITY_LATEST_MIN = 11 * 60
const WINDOW_MS: Record<Exclude<BreakKind, 'afterSession'>, number> = {
  returned: 3 * MINUTE_MS,
  switchedAway: 2 * MINUTE_MS,
  firstActivity: 10 * MINUTE_MS,
}

interface OpenBreak {
  kind: BreakKind
  from: number
  until: number
  score: number
}

export function createReceptivityDetector(opts: ReceptivityOptions): ReceptivityDetector {
  const { bus, clock, signals } = opts
  const lt = opts.localTime ?? systemLocalTime
  let idle: { seconds: number; at: number } | null = null
  let front: { info: FrontmostInfo | null; at: number } | null = null
  let focus: { element: FocusedElement | null; at: number } | null = null
  let app: { bundleId: string; name: string; since: number } | null = null
  let locked = false
  let awaySince: number | null = null
  let lastActivityAt: number | null = null
  let lastActiveDay: string | null = null
  let lastMeetingAt: number | null = null
  let breaks: OpenBreak[] = []
  let sessions: number[] = []
  const listeners = new Set<(kind: BreakKind) => void>()
  const subscriptions: (() => void)[] = []
  const timers = new Set<() => void>()

  function openBreak(kind: BreakKind, from: number, until: number, score: number): void {
    const now = clock.now()
    breaks = [...breaks.filter((b) => b.until > now - 60 * MINUTE_MS), { kind, from, until, score }]
    if (until <= now) return
    for (const listener of listeners) {
      try {
        listener(kind)
      } catch (error) {
        console.error('[receptivity] break listener failed', error)
      }
    }
  }

  function noteActivity(at: number): void {
    if (awaySince !== null && !locked) {
      const awayMs = at - awaySince
      awaySince = null
      if (awayMs >= AWAY_AFTER_S * 1000) {
        openBreak('returned', at, at + WINDOW_MS.returned, awayMs >= LONG_AWAY_S * 1000 ? 1 : 0.7)
      }
    }
    const day = lt.dayKey(at)
    if (lastActiveDay !== day) {
      const firstSample = lastActiveDay === null
      lastActiveDay = day
      if (!firstSample || lt.minuteOfDay(at) < FIRST_ACTIVITY_LATEST_MIN) {
        openBreak('firstActivity', at, at + WINDOW_MS.firstActivity, 1)
      }
    }
    lastActivityAt = lastActivityAt === null ? at : Math.max(lastActivityAt, at)
  }

  function ingestIdle(seconds: number, at: number): void {
    idle = { seconds, at }
    const lastInput = at - seconds * 1000
    if (seconds >= AWAY_AFTER_S) awaySince ??= lastInput
    else noteActivity(lastInput)
  }

  function ingestApp(bundleId: string, name: string, at: number): void {
    if (isTransientApp(bundleId)) return
    if (isMeetingApp(bundleId, name)) lastMeetingAt = Math.max(lastMeetingAt ?? at, at)
    if (app?.bundleId === bundleId || (app && at < app.since)) return // same app, or a stale sample
    const prev = app
    app = { bundleId, name, since: at }
    const stint = prev ? at - prev.since : 0
    if (
      prev &&
      stint >= WORK_STINT_MS &&
      !isLeisureApp(prev.bundleId) &&
      !isMeetingApp(prev.bundleId, prev.name)
    ) {
      openBreak('switchedAway', at, at + WINDOW_MS.switchedAway, 0.8)
    }
    noteActivity(at)
  }

  function ingestFrontmost(info: FrontmostInfo | null, at: number): void {
    front = { info, at }
    if (!info) return
    if (isMeetingApp(info.bundleId, info.appName) || isMeetingPage(info.windowTitle, info.url)) {
      lastMeetingAt = at
    }
    ingestApp(info.bundleId, info.appName, at)
  }

  const lastInputAt = (): number | null => {
    const sampled = idle ? idle.at - idle.seconds * 1000 : null
    if (sampled === null) return lastActivityAt
    return lastActivityAt === null ? sampled : Math.max(sampled, lastActivityAt)
  }

  function isTyping(now: number, idleSeconds: number): boolean {
    const element = focus?.element
    if (!element?.editable) return false
    if (element.isSecure) return true
    return idleSeconds < TYPING_IDLE_S || now - (focus?.at ?? 0) < FOCUS_SETTLE_MS
  }

  function inMeeting(now: number, frontFresh: boolean): boolean {
    if (app && isMeetingApp(app.bundleId, app.name)) return true
    const info = frontFresh ? front?.info : null
    if (
      info &&
      (isMeetingApp(info.bundleId, info.appName) || isMeetingPage(info.windowTitle, info.url))
    ) {
      return true
    }
    return lastMeetingAt !== null && now - lastMeetingAt < MEETING_MEMORY_MS
  }

  function evaluate(nowMs?: number): Receptivity {
    const now = nowMs ?? clock.now()
    const blockers: Blocker[] = []
    if (inQuietHours(now, opts.settings().coaching.quietHours, lt)) blockers.push('quietHours')
    if (locked) blockers.push('locked')
    const lastInput = lastInputAt()
    const idleSeconds = lastInput === null ? Number.POSITIVE_INFINITY : (now - lastInput) / 1000
    if (!idle || now - idle.at > SIGNAL_STALE_MS) blockers.push('noSignal')
    else if (idleSeconds >= AWAY_AFTER_S) blockers.push('away')
    if (isTyping(now, idleSeconds)) blockers.push('typing')
    const frontFresh = front !== null && now - front.at <= SIGNAL_STALE_MS
    if (frontFresh && front?.info?.isFullScreen) blockers.push('fullScreen')
    if (inMeeting(now, frontFresh)) blockers.push('meeting')

    const open = new Map<BreakKind, number>()
    for (const b of breaks) {
      if (b.from <= now && now < b.until) open.set(b.kind, Math.max(open.get(b.kind) ?? 0, b.score))
    }
    if (sessions.some((t) => now >= t + AFTER_SESSION.fromMs && now < t + AFTER_SESSION.toMs)) {
      open.set('afterSession', 0.9)
    }
    const score = blockers.length > 0 ? 0 : Math.max(0, ...open.values())
    return { receptive: score > 0, score, blockers, breaks: [...open.keys()] }
  }

  async function refresh(): Promise<void> {
    const at = clock.now() // the moment the helper was asked
    const [idleResult, frontResult] = await Promise.allSettled([
      signals.idleSeconds(),
      signals.frontmost(),
    ])
    if (idleResult.status === 'fulfilled' && Number.isFinite(idleResult.value)) {
      ingestIdle(Math.max(0, idleResult.value), at)
    }
    if (frontResult.status === 'fulfilled') ingestFrontmost(frontResult.value, at)
  }

  return {
    start() {
      if (subscriptions.length > 0) return
      subscriptions.push(
        bus.on('helper:appActivated', (a) => ingestApp(a.bundleId, a.appName, clock.now())),
        bus.on('helper:focus', ({ app: a, element }) => {
          const at = clock.now()
          focus = { element, at }
          if (a) ingestApp(a.bundleId, a.appName, at)
          noteActivity(at)
        }),
        bus.on('helper:screenLocked', ({ locked: isLocked }) => {
          const at = clock.now()
          locked = isLocked
          if (isLocked) awaySince ??= at
          else noteActivity(at)
        }),
        bus.on('perception:now', ({ now }) => {
          if (now && (isMeetingPage(now.title, now.url) || isMeetingApp(null, now.app))) {
            lastMeetingAt = clock.now()
          }
        }),
        clock.setInterval(() => void refresh().catch(() => {}), opts.pollMs ?? 15_000),
      )
    },
    stop() {
      for (const cancel of subscriptions.splice(0)) cancel()
      for (const cancel of timers) cancel()
      timers.clear()
    },
    refresh,
    evaluate,
    isReceptive: (nowMs) => evaluate(nowMs).receptive,
    noteSessionComplete(atMs) {
      sessions = [...sessions.filter((t) => t + AFTER_SESSION.toMs > atMs), atMs]
      const from = atMs + AFTER_SESSION.fromMs
      const cancel = clock.setTimeout(
        () => {
          timers.delete(cancel)
          openBreak('afterSession', from, atMs + AFTER_SESSION.toMs, 0.9)
        },
        Math.max(0, from - clock.now()),
      )
      timers.add(cancel)
    },
    onBreak(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}
