/**
 * Holds a trigger-key tap back for the double-tap window. The helper emits `tap` on the first
 * release and `doubleTap` on the second, so without this a double-tap ("chat with Dumbledore")
 * would first run the tap's action: insert a prompt, advance the session, toggle the panel.
 *
 * `arm()` is called synchronously when the tap arrives; the tap acts once the window has passed,
 * or does nothing when a double-tap `supersede()`s it meanwhile. The window is the configured
 * double-tap gap plus a typical second press; 0 means taps act at once.
 */
export const SECOND_PRESS_MS = 150

export class TapGuard {
  private waiting: { resolve: (go: boolean) => void; timer: ReturnType<typeof setTimeout> } | null =
    null

  constructor(private readonly doubleTapMs: () => number) {}

  /** Resolves true when the tap may act, false when a double-tap took its place. */
  arm(): Promise<boolean> {
    const gap = this.doubleTapMs()
    if (gap <= 0) return Promise.resolve(true)
    return new Promise((resolve) => {
      const entry = {
        resolve,
        timer: setTimeout(() => {
          if (this.waiting === entry) this.waiting = null
          resolve(true)
        }, gap + SECOND_PRESS_MS),
      }
      this.waiting = entry
    })
  }

  /** A double-tap arrived: the tap that began it does nothing. True when one was waiting. */
  supersede(): boolean {
    const entry = this.waiting
    if (!entry) return false
    this.waiting = null
    clearTimeout(entry.timer)
    entry.resolve(false)
    return true
  }
}
