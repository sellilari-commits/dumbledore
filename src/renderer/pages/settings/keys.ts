/**
 * Keyboard vocabulary shared by Settings → Shortcuts and Onboarding: friendly names for the
 * Dumbledore key, the matching KeyboardEvent codes, and chord → glyph formatting.
 */
import type { TriggerKey } from '@shared/domain'

export interface TriggerKeyInfo {
  /** Menu label, e.g. "Right ⌥ Option". */
  label: string
  /** Short form for sentences, e.g. "right ⌥". */
  short: string
  glyph: string
  /** Word printed on the keycap. */
  word: string
  /** KeyboardEvent.code of this key, and of its twin on the other side. */
  code: string
  mirror: string | null
  mirrorName: string | null
  side: 'right' | 'left' | null
}

export const TRIGGER_KEYS: Record<TriggerKey, TriggerKeyInfo> = {
  rightOption: {
    label: 'Right ⌥ Option',
    short: 'right ⌥',
    glyph: '⌥',
    word: 'option',
    code: 'AltRight',
    mirror: 'AltLeft',
    mirrorName: 'left Option',
    side: 'right',
  },
  leftOption: {
    label: 'Left ⌥ Option',
    short: 'left ⌥',
    glyph: '⌥',
    word: 'option',
    code: 'AltLeft',
    mirror: 'AltRight',
    mirrorName: 'right Option',
    side: 'left',
  },
  rightCommand: {
    label: 'Right ⌘ Command',
    short: 'right ⌘',
    glyph: '⌘',
    word: 'command',
    code: 'MetaRight',
    mirror: 'MetaLeft',
    mirrorName: 'left Command',
    side: 'right',
  },
  rightShift: {
    label: 'Right ⇧ Shift',
    short: 'right ⇧',
    glyph: '⇧',
    word: 'shift',
    code: 'ShiftRight',
    mirror: 'ShiftLeft',
    mirrorName: 'left Shift',
    side: 'right',
  },
  rightControl: {
    label: 'Right ⌃ Control',
    short: 'right ⌃',
    glyph: '⌃',
    word: 'control',
    code: 'ControlRight',
    mirror: 'ControlLeft',
    mirrorName: 'left Control',
    side: 'right',
  },
  fn: {
    label: 'fn / Globe',
    short: 'fn',
    glyph: '🌐',
    word: 'fn',
    code: 'Fn',
    mirror: null,
    mirrorName: null,
    side: null,
  },
}

export const TRIGGER_KEY_ORDER: TriggerKey[] = [
  'rightOption',
  'leftOption',
  'rightCommand',
  'rightShift',
  'rightControl',
  'fn',
]

const GLYPHS: Record<string, string> = {
  control: '⌃',
  ctrl: '⌃',
  option: '⌥',
  alt: '⌥',
  command: '⌘',
  cmd: '⌘',
  shift: '⇧',
}

/** "Control+Option+D" → ["⌃", "⌥", "D"]. */
export function chordKeys(chord: string): string[] {
  return chord
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => GLYPHS[part.toLowerCase()] ?? part.toUpperCase())
}
