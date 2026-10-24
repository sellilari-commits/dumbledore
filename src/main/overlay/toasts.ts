/**
 * Toast queue for the overlay: at most three cards, auto-hide after their TTL (15 s default),
 * all timers paused while the pointer is over the overlay, and per-action callbacks so the code
 * that shows a toast also decides what its buttons do.
 */
import type { Cancel, Clock } from '@engine/clock'
import type { Id } from '@shared/domain'
import type { Toast } from '@shared/state'

export const DEFAULT_TOAST_TTL = 15_000
const MAX_TOASTS = 3

export interface ToastActionSpec {
  id: string
  label: string
  primary?: boolean
  run?: () => void | Promise<void>
}

/** Why a box is shown. Only answers to an explicit gesture are shown (OverlayController). */
export type ToastPurpose = 'selection' | 'instruction-reply' | 'checkpoint-choice' | 'step-waiting'

export interface ToastSpec {
  kind: Toast['kind']
  purpose?: ToastPurpose
  title: string
  body: string
  actions?: ToastActionSpec[]
  ttlMs?: number
  nudgeId?: Id | null
  /** Called when the TTL runs out without the user acting (not on dismiss). */
  onExpire?: () => void
  onDismiss?: () => void
}

interface Entry {
  toast: Toast
  spec: ToastSpec
  remaining: number
  startedAt: number
  cancel: Cancel | null
}

export class ToastCenter {
  private entries: Entry[] = []
  private paused = false
  private seq = 0

  constructor(
    private readonly clock: Clock,
    private readonly onChange: () => void,
  ) {}

  list(): Toast[] {
    return this.entries.map((e) => e.toast)
  }

  show(spec: ToastSpec): string {
    const id = `tst_${this.clock.now().toString(36)}${(++this.seq).toString(36)}`
    const ttl = spec.ttlMs ?? DEFAULT_TOAST_TTL
    const toast: Toast = {
      id,
      kind: spec.kind,
      title: spec.title,
      body: spec.body,
      actions: (spec.actions ?? []).map((a) => ({
        id: a.id,
        label: a.label,
        primary: a.primary ?? false,
      })),
      ttlMs: ttl,
      nudgeId: spec.nudgeId ?? null,
    }
    const entry: Entry = { toast, spec, remaining: ttl, startedAt: this.clock.now(), cancel: null }
    this.entries.push(entry)
    while (this.entries.length > MAX_TOASTS) {
      const oldest = this.entries[0]
      if (oldest) this.expire(oldest)
    }
    if (!this.paused) this.arm(entry)
    this.onChange()
    return id
  }

  /** Runs a toast button's callback and closes the toast. False when the toast is gone. */
  async act(toastId: string, actionId: string): Promise<boolean> {
    const entry = this.entries.find((e) => e.toast.id === toastId)
    if (!entry) return false
    this.remove(entry)
    const action = entry.spec.actions?.find((a) => a.id === actionId)
    await action?.run?.()
    return true
  }

  dismiss(toastId: string): void {
    const entry = this.entries.find((e) => e.toast.id === toastId)
    if (!entry) return
    this.remove(entry)
    entry.spec.onDismiss?.()
  }

  /** Removes toasts matching `pred` without running callbacks. */
  removeWhere(pred: (toast: Toast) => boolean): void {
    for (const entry of [...this.entries]) if (pred(entry.toast)) this.remove(entry)
  }

  /** Hovering the overlay pauses every countdown; leaving resumes with the time that was left. */
  setPaused(paused: boolean): void {
    if (paused === this.paused) return
    this.paused = paused
    const now = this.clock.now()
    for (const entry of this.entries) {
      if (paused) {
        entry.cancel?.()
        entry.cancel = null
        entry.remaining = Math.max(0, entry.remaining - (now - entry.startedAt))
      } else {
        this.arm(entry)
      }
    }
  }

  clear(): void {
    for (const entry of [...this.entries]) this.remove(entry)
  }

  private arm(entry: Entry): void {
    entry.startedAt = this.clock.now()
    entry.cancel?.()
    if (entry.remaining <= 0) return
    entry.cancel = this.clock.setTimeout(() => this.expire(entry), entry.remaining)
  }

  private expire(entry: Entry): void {
    this.remove(entry)
    entry.spec.onExpire?.()
  }

  private remove(entry: Entry): void {
    entry.cancel?.()
    entry.cancel = null
    const before = this.entries.length
    this.entries = this.entries.filter((e) => e !== entry)
    if (this.entries.length !== before) this.onChange()
  }
}
