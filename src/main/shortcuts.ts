/**
 * Global chords (PLAN §5.6): the fallback trigger chord (default ⌃⌥D = tap), ⌃⌥⌘P pause/resume
 * capture, ⌃⌥⌘D open the full app — and Esc, registered only while shortcut work is pending so
 * it never steals Esc from other apps otherwise.
 */
import { globalShortcut } from 'electron'

export interface ChordActions {
  tap: () => void
  toggleCapture: () => void
  openApp: () => void
}

/** "Control+Option+D" → an Electron accelerator ("Option" is valid on macOS; Alt elsewhere). */
export function toAccelerator(chord: string): string {
  return chord
    .split('+')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) =>
      /^(opt|option|⌥)$/i.test(part) ? 'Alt' : /^(cmd|⌘)$/i.test(part) ? 'Command' : part,
    )
    .join('+')
}

function register(accelerator: string, fn: () => void): boolean {
  try {
    return globalShortcut.register(accelerator, fn)
  } catch (error) {
    console.warn(`[shortcuts] cannot register ${accelerator}`, error)
    return false
  }
}

export class GlobalShortcuts {
  private fallback: string | null = null
  private escape = false

  constructor(private readonly actions: ChordActions) {}

  start(fallbackChord: string): void {
    register('Control+Alt+Command+P', this.actions.toggleCapture)
    register('Control+Alt+Command+D', this.actions.openApp)
    this.setFallback(fallbackChord)
  }

  setFallback(chord: string): void {
    const accelerator = toAccelerator(chord)
    if (accelerator === this.fallback) return
    if (this.fallback) globalShortcut.unregister(this.fallback)
    this.fallback = register(accelerator, this.actions.tap) ? accelerator : null
  }

  /** Esc cancels pending work; only registered while something is pending. */
  setEscape(active: boolean, onEscape: () => void): void {
    if (active === this.escape) return
    this.escape = active
    if (active) register('Escape', onEscape)
    else globalShortcut.unregister('Escape')
  }

  stop(): void {
    globalShortcut.unregisterAll()
    this.fallback = null
    this.escape = false
  }
}
