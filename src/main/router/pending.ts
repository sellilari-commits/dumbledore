/**
 * One cancellable piece of shortcut work at a time. While it runs, Esc cancels it (the shell
 * registers a global Esc only for that window of time, via `onBusy`); a cancelled run writes
 * nothing because every step checks the AbortSignal before touching the field.
 */
export class PendingWork {
  private current: AbortController | null = null

  constructor(private readonly onBusy: (busy: boolean) => void = () => undefined) {}

  get busy(): boolean {
    return this.current !== null
  }

  /** Runs `fn` unless something is already pending. Resolves false when skipped or cancelled. */
  async run(fn: (signal: AbortSignal) => Promise<unknown>): Promise<boolean> {
    if (this.current) return false
    const controller = new AbortController()
    this.current = controller
    this.onBusy(true)
    try {
      await fn(controller.signal)
      return !controller.signal.aborted
    } finally {
      if (this.current === controller) this.current = null
      this.onBusy(false)
    }
  }

  cancel(): boolean {
    if (!this.current) return false
    this.current.abort()
    return true
  }
}
