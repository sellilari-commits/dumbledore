/**
 * Nudge engine (Goldfish-style, PLAN §6.6): one `run` = expire stale nudges, re-show a snoozed
 * one whose hour is up, or pick the best candidate (value × receptivity − fatigue, above the
 * threshold, within the hard caps, not a duplicate), word it, save it, and announce it as
 * 'nudge:ready' + 'toast:show'. `act` records accept / dismiss / snooze (+1 h); unanswered
 * nudges expire after 1 h.
 */
import type { Brain } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { newId } from '@engine/ids'
import type { CoachAction, Id, Nudge } from '@shared/domain'
import type { Toast } from '@shared/state'
import { DAY_MS, type LocalTime, systemLocalTime } from './local-time'
import type { NudgeCandidate } from './nudge-common'
import {
  type CapInput,
  checkCaps,
  FATIGUE_WINDOW_MS,
  fatigue,
  isExpired,
  isOpen,
  NUDGE_TTL_MS,
  nudgeScore,
  SHOW_THRESHOLD,
  SNOOZE_MS,
} from './nudge-policy'
import { writeNudgeText } from './nudge-text'
import type { Receptivity } from './receptivity'

export type NudgeAction = 'accept' | 'dismiss' | 'snooze'

export interface NudgeActResult {
  nudge: Nudge
  /** What to run now (accepted nudges only); the shell executes it like a coach action. */
  action: CoachAction | null
}

export interface NudgeRunInput {
  nowMs: number
  receptivity: Receptivity
  candidates: () => NudgeCandidate[]
}

export interface NudgeEngine {
  run(input: NudgeRunInput): Promise<Nudge | null>
  act(nudgeId: Id, action: NudgeAction): NudgeActResult
  /** Expires pending nudges past their hour and snoozes left from earlier days. */
  expireStale(nowMs: number): Id[]
  /** Called when a snooze ends, so the owner can run a check. */
  onSnoozeEnd(listener: () => void): () => void
  dispose(): void
}

export interface NudgeEngineDeps {
  repos: Repos
  brain: Brain
  bus: EngineBus
  clock: Clock
  localTime?: LocalTime
  log?: (message: string, error?: unknown) => void
}

const iso = (ms: number): string => new Date(ms).toISOString()
const ms = (value: string | null): number | null => {
  const t = value ? Date.parse(value) : Number.NaN
  return Number.isNaN(t) ? null : t
}

const ACCEPT_LABEL: Record<CoachAction['type'], string> = {
  start_review: 'Start',
  create_exam: 'Quiz me',
  start_roadmap: 'Start',
  open_subject: 'Open',
  insert_prompt: 'Use prompt',
  set_focus: 'Focus',
  adjust_roadmap: 'Update',
  add_note: 'Save note',
  undo_note: 'Undo',
  give_feedback: 'Send',
  save_question: 'Save',
  update_subject: 'Save',
  undo_save: 'Undo',
  run_tool: 'Confirm',
}

export function nudgeToast(nudge: Nudge): Toast {
  return {
    id: newId('tst'),
    kind: 'nudge',
    title: nudge.title,
    body: nudge.body,
    actions: [
      {
        id: 'accept',
        label: nudge.action ? ACCEPT_LABEL[nudge.action.type] : 'Got it',
        primary: true,
      },
      { id: 'snooze', label: 'In 1 hour', primary: false },
      { id: 'dismiss', label: 'Not now', primary: false },
    ],
    ttlMs: 15_000,
    nudgeId: nudge.id,
  }
}

export function createNudgeEngine(deps: NudgeEngineDeps): NudgeEngine {
  const { repos, brain, bus, clock } = deps
  const lt = deps.localTime ?? systemLocalTime
  const log = deps.log ?? ((m: string, e?: unknown) => console.warn(`[nudges] ${m}`, e ?? ''))
  const snoozedUntil = new Map<Id, number>()
  const timers = new Set<() => void>()
  const snoozeListeners = new Set<() => void>()

  const recent = (nowMs: number) => repos.nudges.listSince(iso(nowMs - FATIGUE_WINDOW_MS))
  const changed = (ids: Id[]) => {
    if (ids.length > 0) bus.emit('memory:changed', { scope: 'nudges', ids })
  }

  function later(delayMs: number, fn: () => void): void {
    const cancel = clock.setTimeout(() => {
      timers.delete(cancel)
      fn()
    }, delayMs)
    timers.add(cancel)
  }

  function announce(nudge: Nudge): void {
    bus.emit('nudge:ready', { nudge })
    bus.emit('toast:show', { toast: nudgeToast(nudge) })
    changed([nudge.id])
    later(NUDGE_TTL_MS + 1, () => expireStale(clock.now()))
  }

  const snoozeEnd = (n: Nudge): number => snoozedUntil.get(n.id) ?? (ms(n.shownAt) ?? 0) + SNOOZE_MS

  function expireStale(nowMs: number): Id[] {
    const today = lt.dayStart(nowMs)
    const expired: Id[] = []
    for (const n of recent(nowMs)) {
      const leftover = n.outcome === 'snoozed' && (ms(n.createdAt) ?? 0) < today
      if (!isExpired(n, nowMs) && !leftover) continue
      repos.nudges.update(n.id, { outcome: 'expired' })
      snoozedUntil.delete(n.id)
      expired.push(n.id)
    }
    changed(expired)
    return expired
  }

  async function run({ nowMs, receptivity, candidates }: NudgeRunInput): Promise<Nudge | null> {
    expireStale(nowMs)
    const coaching = repos.settings.get().coaching
    const all = recent(nowMs)
    const dayStart = lt.dayStart(nowMs)
    const shownTimes = all.map((n) => ms(n.shownAt)).filter((t): t is number => t !== null)
    const caps: CapInput = {
      nowMs,
      coaching,
      todayCount: all.filter((n) => (ms(n.createdAt) ?? 0) >= dayStart).length,
      lastShownAt: shownTimes.length > 0 ? Math.max(...shownTimes) : null,
      openCount: all.filter((n) => isOpen(n, nowMs)).length,
    }

    // 1. A snoozed nudge whose hour is up comes back (it was already counted for today).
    const snoozed = all.find((n) => n.outcome === 'snoozed' && snoozeEnd(n) <= nowMs)
    if (snoozed) {
      const free = checkCaps(caps, { countToday: false }).ok
      if (receptivity.blockers.length === 0 && free) {
        snoozedUntil.delete(snoozed.id)
        const shown = repos.nudges.update(snoozed.id, { outcome: 'pending', shownAt: iso(nowMs) })
        announce(shown)
        return shown
      }
    }

    // 2. A new nudge, only at a natural break and within the caps.
    if (!receptivity.receptive || !checkCaps(caps).ok) return null
    const sinceIso = iso(nowMs - 30 * DAY_MS)
    const tipToday = all.some((n) => n.kind === 'tip' && (ms(n.createdAt) ?? 0) >= dayStart)
    const ranked = candidates()
      .filter((c) => !(c.kind === 'tip' && tipToday))
      .filter((c) => repos.nudges.findByDedupeKey(c.dedupeKey, sinceIso) === null)
      .map((c) => ({
        c,
        score: nudgeScore(c.value, receptivity.score, fatigue(all, c.kind, nowMs)),
      }))
      .filter((x) => x.score >= SHOW_THRESHOLD)
      .sort((a, b) => b.score - a.score)
    const best = ranked[0]?.c
    if (!best) return null

    const language = repos.profile.get().promptLanguage
    const text = await writeNudgeText(
      brain,
      {
        kind: best.kind,
        facts: best.facts,
        language: language === 'auto' ? 'en' : language,
        fallback: best.fallback,
      },
      log,
    )
    const added = repos.nudges.add({
      kind: best.kind,
      title: text.title,
      body: text.body,
      action: best.action,
      dedupeKey: best.dedupeKey,
    })
    const shown = repos.nudges.update(added.id, { shownAt: iso(clock.now()) })
    announce(shown)
    return shown
  }

  function act(nudgeId: Id, action: NudgeAction): NudgeActResult {
    const nowMs = clock.now()
    const nudge = repos.nudges.listSince(iso(nowMs - 30 * DAY_MS)).find((n) => n.id === nudgeId)
    if (!nudge) throw new Error(`nudge ${nudgeId} not found`)
    if (nudge.outcome !== 'pending' && nudge.outcome !== 'snoozed') return { nudge, action: null }
    snoozedUntil.delete(nudgeId)
    if (action === 'snooze') {
      snoozedUntil.set(nudgeId, nowMs + SNOOZE_MS)
      later(SNOOZE_MS, () => {
        for (const listener of snoozeListeners) listener()
      })
    }
    const outcome =
      action === 'accept' ? 'accepted' : action === 'dismiss' ? 'dismissed' : 'snoozed'
    const updated = repos.nudges.update(nudgeId, { outcome })
    changed([nudgeId])
    return { nudge: updated, action: action === 'accept' ? updated.action : null }
  }

  return {
    run,
    act,
    expireStale,
    onSnoozeEnd(listener) {
      snoozeListeners.add(listener)
      return () => snoozeListeners.delete(listener)
    },
    dispose() {
      for (const cancel of timers) cancel()
      timers.clear()
    },
  }
}
