/**
 * Trigger-key gestures in the app window. Main forwards the helper's gestures for the configured
 * key as 'key.gesture' (works whatever app is in front). While this window has focus the same
 * presses also arrive as DOM key events — the only way to see a *wrong* key (left ⌥) — so
 * `useKeyGestures` runs a clean-tap detector over them too and drops the duplicate when both
 * sources report one press. Key names are the TriggerKey names ('rightOption', …) plus the
 * left-hand twins ('leftCommand', 'leftShift', 'leftControl').
 */
import type { EventPayload } from '@shared/ipc'
import { useEffect, useRef } from 'react'
import { on } from './api'

export type KeyGesture = EventPayload<'key.gesture'>
export type GestureKind = KeyGesture['gesture']

/** KeyboardEvent.code → key name. */
export const MODIFIER_CODES: Readonly<Record<string, string>> = {
  AltRight: 'rightOption',
  AltLeft: 'leftOption',
  MetaRight: 'rightCommand',
  MetaLeft: 'leftCommand',
  ShiftRight: 'rightShift',
  ShiftLeft: 'leftShift',
  ControlRight: 'rightControl',
  ControlLeft: 'leftControl',
  Fn: 'fn',
}

export interface GestureTiming {
  tapMaxMs: number
  holdMinMs: number
  doubleTapMs: number
}

export const DEFAULT_TIMING: GestureTiming = { tapMaxMs: 350, holdMinMs: 500, doubleTapMs: 300 }

/** Two reports of the same gesture closer than this are one press seen twice. */
const DUPLICATE_MS = 400

type KeyLike = Pick<KeyboardEvent, 'code' | 'repeat'>

export interface GestureDetector {
  keydown(e: KeyLike): void
  keyup(e: KeyLike): void
  /** Forget a half-finished press (window lost focus, unmount). */
  reset(): void
}

/**
 * Clean-tap detection like the helper's: a modifier pressed and released alone within tapMaxMs
 * is a tap (a second one within doubleTapMs a double-tap); held for holdMinMs it is a hold
 * (holdStart, then holdEnd on release). Any other key in between makes it a chord — ignored.
 */
export function createGestureDetector(
  timing: GestureTiming,
  emit: (g: KeyGesture) => void,
  now: () => number = () => Date.now(),
): GestureDetector {
  let down: { key: string; at: number; chord: boolean; held: boolean } | null = null
  let holdTimer: ReturnType<typeof setTimeout> | null = null
  let lastTap: { key: string; at: number } | null = null

  const clearHold = () => {
    if (holdTimer !== null) clearTimeout(holdTimer)
    holdTimer = null
  }

  return {
    keydown(e) {
      if (e.repeat) return
      const key = MODIFIER_CODES[e.code]
      if (down) {
        down.chord = true
        clearHold()
        return
      }
      if (!key) return
      const press = { key, at: now(), chord: false, held: false }
      down = press
      holdTimer = setTimeout(() => {
        holdTimer = null
        if (down !== press || press.chord) return
        press.held = true
        emit({ gesture: 'holdStart', key })
      }, timing.holdMinMs)
    },
    keyup(e) {
      const key = MODIFIER_CODES[e.code]
      if (!down || key !== down.key) return
      const press = down
      down = null
      clearHold()
      if (press.held) {
        emit({ gesture: 'holdEnd', key: press.key })
        return
      }
      const t = now()
      if (press.chord || t - press.at > timing.tapMaxMs) return
      if (lastTap && lastTap.key === press.key && t - lastTap.at <= timing.doubleTapMs) {
        lastTap = null
        emit({ gesture: 'doubleTap', key: press.key })
        return
      }
      lastTap = { key: press.key, at: t }
      emit({ gesture: 'tap', key: press.key })
    },
    reset() {
      clearHold()
      down = null
    },
  }
}

/**
 * Calls `onGesture` for every trigger-key gesture: 'key.gesture' events from main plus presses
 * seen by this window (with `timing` from Settings → Shortcuts). Duplicates are merged.
 */
export function useKeyGestures(
  onGesture: (g: KeyGesture) => void,
  timing: GestureTiming = DEFAULT_TIMING,
  enabled = true,
): void {
  const ref = useRef(onGesture)
  ref.current = onGesture
  const { tapMaxMs, holdMinMs, doubleTapMs } = timing
  useEffect(() => {
    if (!enabled) return
    let last: { gesture: GestureKind; key: string; at: number } | null = null
    const deliver = (g: KeyGesture) => {
      const at = Date.now()
      if (last && last.gesture === g.gesture && last.key === g.key && at - last.at < DUPLICATE_MS)
        return
      last = { gesture: g.gesture, key: g.key, at }
      ref.current(g)
    }
    const off = on('key.gesture', deliver)
    const detector = createGestureDetector({ tapMaxMs, holdMinMs, doubleTapMs }, deliver)
    const down = (e: KeyboardEvent) => detector.keydown(e)
    const up = (e: KeyboardEvent) => detector.keyup(e)
    const blur = () => detector.reset()
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)
    window.addEventListener('blur', blur)
    return () => {
      off()
      detector.reset()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      window.removeEventListener('blur', blur)
    }
  }, [enabled, tapMaxMs, holdMinMs, doubleTapMs])
}
