/**
 * Capture cadence (docs/PLAN.md §6.4): active (input in the last minute) every 1 s, idle 60 s+
 * every 10 s, idle 5 min+ or locked → paused (we only poll idle to notice the return), Low Power
 * Mode doubles every interval. Pure function so the policy is easy to test.
 */

export type CaptureMode = 'active' | 'idle' | 'paused'

export const CADENCE = {
  idleAfterSeconds: 60,
  pauseAfterSeconds: 300,
  pausedPollMs: 5000,
  lowPowerFactor: 2,
} as const

export interface CadenceInput {
  idleSeconds: number
  locked: boolean
  lowPower: boolean
  activeMs: number // settings.cadence.activeMs
  idleMs: number // settings.cadence.idleMs
}

export function cadenceFor(input: CadenceInput): { mode: CaptureMode; intervalMs: number } {
  const factor = input.lowPower ? CADENCE.lowPowerFactor : 1
  const active = Math.max(250, input.activeMs)
  const idle = Math.max(active, input.idleMs)
  if (input.locked || input.idleSeconds >= CADENCE.pauseAfterSeconds) {
    return { mode: 'paused', intervalMs: CADENCE.pausedPollMs * factor }
  }
  if (input.idleSeconds >= CADENCE.idleAfterSeconds)
    return { mode: 'idle', intervalMs: idle * factor }
  return { mode: 'active', intervalMs: active * factor }
}
