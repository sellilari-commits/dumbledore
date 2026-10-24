/**
 * Nudge policy (PLAN §6.6), pure: hard caps (nudges per day, minimum gap, one open nudge at a
 * time), fatigue (recent nudges, dismissal rate, the same kind dismissed lately) and the score
 * value × receptivity − fatigue that a candidate must reach to be shown.
 */
import type { Nudge, NudgeKind, Settings } from '@shared/domain'
import { DAY_MS, HOUR_MS, MINUTE_MS } from './local-time'

export const SHOW_THRESHOLD = 0.25
/** An unanswered nudge collapses into the orb's dot and expires after this. */
export const NUDGE_TTL_MS = HOUR_MS
export const SNOOZE_MS = HOUR_MS
/** How far back fatigue looks. */
export const FATIGUE_WINDOW_MS = 7 * DAY_MS

export type CapVerdict = { ok: true } | { ok: false; reason: 'open' | 'dailyCap' | 'minGap' }

export interface CapInput {
  nowMs: number
  coaching: Settings['coaching']
  /** Nudges created since local midnight. */
  todayCount: number
  /** Latest time any nudge was shown (re-shows included). */
  lastShownAt: number | null
  /** Shown, unanswered and not yet expired. */
  openCount: number
}

export function checkCaps(input: CapInput, opts: { countToday?: boolean } = {}): CapVerdict {
  if (input.openCount > 0) return { ok: false, reason: 'open' }
  if ((opts.countToday ?? true) && input.todayCount >= Math.max(0, input.coaching.nudgesPerDay)) {
    return { ok: false, reason: 'dailyCap' }
  }
  const gapMs = Math.max(0, input.coaching.minGapMinutes) * MINUTE_MS
  if (input.lastShownAt !== null && input.nowMs - input.lastShownAt < gapMs) {
    return { ok: false, reason: 'minGap' }
  }
  return { ok: true }
}

const ms = (iso: string | null): number | null => {
  if (!iso) return null
  const t = Date.parse(iso)
  return Number.isNaN(t) ? null : t
}

/**
 * 0.1 per nudge shown in the last 3 h, up to 0.3 for a high dismissal rate (ignored nudges count
 * half; needs ≥ 3 answered nudges in the last week), and 0.3 when this kind was dismissed in the
 * last 24 h.
 */
export function fatigue(recent: readonly Nudge[], kind: NudgeKind, nowMs: number): number {
  const lastThreeHours = recent.filter((n) => {
    const shown = ms(n.shownAt)
    return shown !== null && shown <= nowMs && nowMs - shown < 3 * HOUR_MS
  }).length
  const settled = recent.filter(
    (n) => n.outcome === 'accepted' || n.outcome === 'dismissed' || n.outcome === 'expired',
  )
  const negative =
    settled.filter((n) => n.outcome === 'dismissed').length +
    0.5 * settled.filter((n) => n.outcome === 'expired').length
  const rate = settled.length >= 3 ? negative / settled.length : 0
  const sameKindDismissed = recent.some((n) => {
    const created = ms(n.createdAt)
    return (
      n.kind === kind && n.outcome === 'dismissed' && created !== null && nowMs - created < DAY_MS
    )
  })
  return 0.1 * lastThreeHours + 0.3 * rate + (sameKindDismissed ? 0.3 : 0)
}

export const nudgeScore = (value: number, receptivity: number, tiredness: number): number =>
  value * receptivity - tiredness

/** Pending nudges that are past their hour. Never-shown ones count from creation. */
export function isExpired(nudge: Nudge, nowMs: number): boolean {
  if (nudge.outcome !== 'pending') return false
  const since = ms(nudge.shownAt) ?? ms(nudge.createdAt)
  return since !== null && nowMs - since >= NUDGE_TTL_MS
}

export function isOpen(nudge: Nudge, nowMs: number): boolean {
  return nudge.outcome === 'pending' && nudge.shownAt !== null && !isExpired(nudge, nowMs)
}
