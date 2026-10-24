/**
 * Keyboard shortcuts. Combos are written like 'mod+k', 'mod+shift+l', 'mod+\\', 'mod+[' where
 * mod is ⌘ on macOS (Ctrl elsewhere). Handlers get the event and prevent default when they fire.
 */
import { useEffect, useRef } from 'react'

export type HotkeyMap = Record<string, (event: KeyboardEvent) => void>

const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform ?? '')

export function matches(combo: string, e: KeyboardEvent): boolean {
  const parts = combo.toLowerCase().split('+')
  const key = parts.pop() ?? ''
  const want = new Set(parts)
  const mod = isMac ? e.metaKey : e.ctrlKey
  if (want.has('mod') !== mod) return false
  if (want.has('shift') !== e.shiftKey) return false
  if (want.has('alt') !== e.altKey) return false
  if (!want.has('mod') && (e.metaKey || e.ctrlKey)) return false
  const pressed = e.key.length === 1 ? e.key.toLowerCase() : e.key.toLowerCase()
  // e.code fallback keeps ⌘[ and ⌘\ working on layouts where the key prints something else.
  const byCode: Record<string, string> = {
    '[': 'BracketLeft',
    ']': 'BracketRight',
    '\\': 'Backslash',
    ',': 'Comma',
  }
  return pressed === key || (byCode[key] !== undefined && e.code === byCode[key])
}

export function useHotkeys(map: HotkeyMap, enabled = true): void {
  const ref = useRef(map)
  ref.current = map
  useEffect(() => {
    if (!enabled) return
    const onKey = (e: KeyboardEvent) => {
      for (const [combo, fn] of Object.entries(ref.current)) {
        if (matches(combo, e)) {
          e.preventDefault()
          fn(e)
          return
        }
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [enabled])
}

/** Display form of a combo: 'mod+shift+l' → '⌘⇧L'. */
export function comboLabel(combo: string): string {
  const map: Record<string, string> = {
    mod: isMac ? '⌘' : 'Ctrl+',
    shift: '⇧',
    alt: '⌥',
    enter: '↵',
    escape: 'Esc',
  }
  return combo
    .split('+')
    .map((p) => map[p] ?? p.toUpperCase())
    .join('')
}
