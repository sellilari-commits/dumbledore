/**
 * The router's short toasts: the gesture hint ("Hold ⌥ to rewrite your prompt"), a refused password
 * field and an unreadable chat box. Hints name the configured key by its glyph.
 */
import type { TriggerKey } from '@shared/domain'
import type { ToastSpec } from '../overlay/toasts'
import type { Hint } from './decide'

const GLYPH: Record<TriggerKey, string> = {
  rightOption: '⌥',
  leftOption: '⌥',
  rightCommand: '⌘',
  rightShift: '⇧',
  rightControl: '⌃',
  fn: 'fn',
}

export function keyGlyph(key: TriggerKey): string {
  return GLYPH[key] ?? '⌥'
}

export function hintToast(_hint: Hint, key: TriggerKey): ToastSpec {
  return {
    kind: 'tip',
    title: `Hold ${keyGlyph(key)} to rewrite your prompt`,
    body: 'Dumbledore rewrites what you typed, right in the box. ⌘Z undoes it.',
    ttlMs: 5000,
  }
}

export const REFUSE_SECURE: ToastSpec = {
  kind: 'info',
  title: 'Password field',
  body: 'Dumbledore never reads or writes password fields.',
  ttlMs: 4000,
}

export function unreadableToast(key: TriggerKey): ToastSpec {
  const k = keyGlyph(key)
  return {
    kind: 'error',
    title: "Couldn't read that field",
    body: `Select the text and tap ${k} again, or double-tap ${k} to chat with Dumbledore.`,
    ttlMs: 6000,
  }
}
