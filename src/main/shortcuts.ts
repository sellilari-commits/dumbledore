/**
 * Global chords (PLAN §5.6): the fallback trigger chord (default ⌃⌥D = tap), ⌃⌥⌘P pause/resume
 * capture, ⌃⌥⌘D open the full app. Esc is registered only while shortcut work is pending or the
 * quiz card is open, so it never steals Esc from other apps otherwise.
 *
 * The quiz card lives in the overlay, which never takes focus: while it is open, 1–4 and Enter
 * are grabbed too and forwarded to it (released as soon as the card closes).
 */
import { globalShortcut } from 'electron'

export interface ChordActions {
  tap: () => void
  toggleCapture: () => void
  openApp: () => void
}

/** The part of Electron's globalShortcut this module uses (injectable for tests). */
export interface ShortcutRegistry {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
  unregisterAll(): void
}

/** Keys the quiz card understands, as Electron key codes. */
export type QuizKey = '1' | '2' | '3' | '4' | 'Return' | 'Escape'
const QUIZ_PICK_KEYS = ['1', '2', '3', '4', 'Return'] as const

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

export class GlobalShortcuts {
  private fallback: string | null = null
  private readonly escape: { pending: (() => void) | null; quiz: (() => void) | null } = {
    pending: null,
    quiz: null,
  }
  private escapeRegistered = false
  private quizKeys = false

  constructor(
    private readonly actions: ChordActions,
    private readonly registry: ShortcutRegistry = globalShortcut,
  ) {}

  start(fallbackChord: string): void {
    this.register('Control+Alt+Command+P', this.actions.toggleCapture)
    this.register('Control+Alt+Command+D', this.actions.openApp)
    this.setFallback(fallbackChord)
  }

  setFallback(chord: string): void {
    const accelerator = toAccelerator(chord)
    if (accelerator === this.fallback) return
    if (this.fallback) this.registry.unregister(this.fallback)
    this.fallback = this.register(accelerator, this.actions.tap) ? accelerator : null
  }

  /** Esc cancels pending shortcut work; only registered while something is pending. */
  setEscape(active: boolean, onEscape: () => void): void {
    this.escape.pending = active ? onEscape : null
    this.syncEscape()
  }

  /** While the quiz card is open, 1–4, Enter and Esc go to `forward`. */
  setQuizKeys(active: boolean, forward: (key: QuizKey) => void): void {
    if (active === this.quizKeys) return
    this.quizKeys = active
    for (const key of QUIZ_PICK_KEYS) {
      if (active) this.register(key, () => forward(key))
      else this.registry.unregister(key)
    }
    this.escape.quiz = active ? () => forward('Escape') : null
    this.syncEscape()
  }

  stop(): void {
    this.registry.unregisterAll()
    this.fallback = null
    this.escape.pending = null
    this.escape.quiz = null
    this.escapeRegistered = false
    this.quizKeys = false
  }

  /** One Esc registration serves both owners: pending work is cancelled first, then the quiz. */
  private syncEscape(): void {
    const wanted = this.escape.pending !== null || this.escape.quiz !== null
    if (wanted === this.escapeRegistered) return
    if (wanted) {
      this.escapeRegistered = this.register('Escape', () =>
        (this.escape.pending ?? this.escape.quiz)?.(),
      )
    } else {
      this.registry.unregister('Escape')
      this.escapeRegistered = false
    }
  }

  private register(accelerator: string, fn: () => void): boolean {
    try {
      return this.registry.register(accelerator, fn)
    } catch (error) {
      console.warn(`[shortcuts] cannot register ${accelerator}`, error)
      return false
    }
  }
}
