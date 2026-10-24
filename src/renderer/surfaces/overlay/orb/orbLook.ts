/**
 * Reduces OverlayState.orb to what the orb draws. `visual` is main's summary; the booleans let
 * states combine (e.g. a session ring with the thinking arc while the next prompt is written).
 */
import type { OverlayState } from '@shared/state'

export interface OrbLook {
  size: number
  docked: boolean
  paused: boolean
  thinking: boolean
  /** Share of the session done (0–1), or null when no session ring shows. */
  progress: number | null
  dot: 'none' | 'blue' | 'orange'
}

export const ORB_SIZE = 40
export const DOCKED_SIZE = 28

export function orbLook(orb: OverlayState['orb']): OrbLook {
  const docked = orb.docked || orb.visual === 'docked'
  const size = orb.size > 0 ? orb.size : docked ? DOCKED_SIZE : ORB_SIZE
  const progress =
    orb.progress && orb.progress.n > 0
      ? Math.min(1, Math.max(0, orb.progress.k / orb.progress.n))
      : null
  const dot = orb.dot !== 'none' ? orb.dot : orb.visual === 'attention' ? 'orange' : 'none'
  return {
    size,
    docked,
    paused: orb.paused || orb.visual === 'paused',
    thinking: orb.thinking || orb.visual === 'thinking',
    progress,
    dot,
  }
}

/** Accessible name that carries the orb's status, since the status itself is only glyphs. */
export function orbLabel(look: OrbLook, orb: OverlayState['orb']): string {
  const parts = ['Dumbledore']
  if (look.paused) parts.push('capture paused')
  if (look.thinking) parts.push('thinking')
  if (orb.progress && look.progress !== null)
    parts.push(`step ${orb.progress.k} of ${orb.progress.n}`)
  if (look.dot !== 'none') parts.push('something is waiting')
  return parts.join(', ')
}
