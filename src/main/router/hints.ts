/**
 * The router's short toasts: a refused password field and an unreadable chat box. They name the
 * configured key by its glyph.
 */
import type { TriggerKey } from '@shared/domain'
import type { ToastSpec } from '../overlay/toasts'

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
