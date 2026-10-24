/**
 * The "learn the key" lesson as a small state machine over trigger-key gestures: a clean tap
 * of the configured key passes; a wrong key ("That’s left ⌥ — tap right ⌥ instead") or a hold
 * before the first tap get a coaching line instead. After the tap, the hold (tell Dumbledore what
 * you want, it writes the prompt) and the double-tap (the chat) are explained and recognised. `react` is exported for tests.
 */
import { type KeyGesture, useKeyGestures } from '@renderer/lib/gestures'
import type { Settings, TriggerKey } from '@shared/domain'
import { useCallback, useEffect, useState } from 'react'
import { TRIGGER_KEYS } from '../settings/keys'

export type Tone = 'idle' | 'good' | 'warn'

export interface LessonState {
  tapped: boolean
  held: boolean
  /** A double-tap was seen (it opens the chat with Dumbledore). */
  doubled: boolean
  /** The keycap is held down (between holdStart and holdEnd). */
  down: boolean
  /** Counts clean presses of the right key; the keycap replays its press animation on change. */
  presses: number
  verdict: { tone: Tone; text: string }
}

const LEFT_NAMES: Record<string, string> = {
  leftCommand: 'left ⌘',
  leftShift: 'left ⇧',
  leftControl: 'left ⌃',
}

/** Where to find each key on a Mac keyboard. */
export const WHERE: Record<TriggerKey, string> = {
  rightOption: 'two keys right of the space bar',
  leftOption: 'two keys left of the space bar',
  rightCommand: 'right next to the space bar',
  rightShift: 'above the arrow keys',
  rightControl: 'at the far right of the bottom row',
  fn: 'in the bottom-left corner',
}

export function keyName(key: string): string {
  return TRIGGER_KEYS[key as TriggerKey]?.short ?? LEFT_NAMES[key] ?? key
}

export function initialLesson(key: TriggerKey): LessonState {
  return {
    tapped: false,
    held: false,
    doubled: false,
    down: false,
    presses: 0,
    verdict: { tone: 'idle', text: `Waiting for ${keyName(key)}…` },
  }
}

const HOLD = 'tell Dumbledore what you want, it writes the prompt'

/** The next lesson state after one gesture. Pure, so it is easy to test. */
export function react(state: LessonState, g: KeyGesture, key: TriggerKey): LessonState {
  const want = keyName(key)
  // The backup chord (⌃⌥D by default) always works as a tap: count it, then teach the key.
  if (g.key === 'fallbackChord') {
    if (g.gesture !== 'tap') return state
    return {
      ...state,
      tapped: true,
      down: false,
      presses: state.presses + 1,
      verdict: { tone: 'good', text: `That’s the backup chord: it works like a tap of ${want}.` },
    }
  }
  if (g.key !== key) {
    if (g.gesture === 'holdEnd') return state
    return {
      ...state,
      down: false,
      verdict: { tone: 'warn', text: `That’s ${keyName(g.key)} — tap ${want} instead.` },
    }
  }
  switch (g.gesture) {
    case 'tap':
      return {
        ...state,
        tapped: true,
        down: false,
        presses: state.presses + 1,
        verdict: !state.tapped
          ? {
              tone: 'good',
              text: `That’s it — tap ${want} in an AI chat for a prompt on what you studied last.`,
            }
          : { tone: 'good', text: `That’s a tap. ${nextMove(state)}` },
      }
    case 'doubleTap': {
      const next = { ...state, tapped: true, doubled: true }
      return {
        ...next,
        down: false,
        presses: state.presses + 1,
        verdict: {
          tone: 'good',
          text: `That’s a double-tap: it opens a chat with Dumbledore. ${nextMove(next)}`,
        },
      }
    }
    case 'holdStart':
      return {
        ...state,
        down: true,
        verdict: state.tapped
          ? {
              tone: 'good',
              text: 'Holding… now tell Dumbledore what you want, it writes the prompt.',
            }
          : {
              tone: 'warn',
              text: `That’s a hold — ${HOLD}. First a quick tap: press ${want} and let go.`,
            },
      }
    case 'holdEnd': {
      if (!state.tapped) return { ...state, down: false }
      const next = { ...state, held: true }
      return {
        ...next,
        down: false,
        verdict: {
          tone: 'good',
          text: `That’s a hold: ${HOLD}. ${nextMove(next)}`,
        },
      }
    }
  }
}

/** What to try next, once the first tap is done. */
function nextMove(s: LessonState): string {
  if (!s.held) return 'Now hold it for half a second.'
  if (!s.doubled) return 'Now double-tap it: two quick taps.'
  return 'Tap, hold, double-tap — you’ve got all three.'
}

export function useKeyLesson(shortcut: Settings['shortcut']): LessonState {
  const { key } = shortcut
  const [state, setState] = useState(() => initialLesson(key))
  useEffect(() => setState(initialLesson(key)), [key])
  const onGesture = useCallback((g: KeyGesture) => setState((s) => react(s, g, key)), [key])
  useKeyGestures(onGesture, shortcut)
  return state
}
