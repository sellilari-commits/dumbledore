/**
 * ChatWriter: puts text into the student's AI chat box (or the field they tapped in), never
 * sending it.
 *
 * 1. Hand focus back if Dumbledore is active (FocusKeeper: app.hide → app.activate → verify).
 * 2. Refuse to write when the frontmost app or the focused field changed since the user asked.
 * 3. Find the chat input (helper ax.findChatInput with the AI-chat placeholders).
 * 4. Write with helper input.write (expectPid), which verifies and restores the clipboard.
 * On failure the text goes to the clipboard with a "Copied — press ⌘V" toast.
 */
import type { HelperClient, PerceptionService } from '@engine/contracts'
import { type Rect, rectCenter } from '@shared/geometry'
import type { FocusedElement } from '@shared/helper-protocol'
import type { ToastSpec } from '../overlay/toasts'
import type { ShellPlatform } from '../platform'
import type { FocusKeeper } from './focus-keeper'
import { CHAT_INPUT_PLACEHOLDERS } from './placeholders'

/** The field the user was in when they asked; writing is skipped if it is no longer focused. */
export interface FieldSnapshot {
  pid: number
  ref: string | null
  role: string | null
  frame: Rect | null
}

export interface WriteRequest {
  text: string
  mode: 'insert' | 'replaceAll'
  /** 'chat': the AI chat input of the target app; 'focused': the field in `expect`. */
  target: 'chat' | 'focused'
  expect?: FieldSnapshot | null
  /** Target app; defaults to the snapshot's app, then the AI chat, then the remembered app. */
  pid?: number | null
  signal?: AbortSignal
  /** Copy + toast when writing fails (default true). */
  fallbackToClipboard?: boolean
}

export interface WriteOutcome {
  ok: boolean
  method: 'ax' | 'paste' | 'clipboard' | null
  reason: string | null
}

export interface ChatWriterDeps {
  helper: HelperClient
  focus: FocusKeeper
  platform: ShellPlatform
  perception: Pick<PerceptionService, 'aiChat'>
  notify: (toast: ToastSpec) => void
}

export function snapshotOf(el: FocusedElement): FieldSnapshot {
  return { pid: el.pid, ref: el.ref, role: el.role, frame: el.frame }
}

/** Same field as the snapshot: same ref when both have one, else same role and position. */
export function sameField(el: FocusedElement | null, snap: FieldSnapshot): boolean {
  if (!el || el.pid !== snap.pid) return false
  if (el.ref !== null && snap.ref !== null) return el.ref === snap.ref
  if (el.role !== snap.role) return false
  if (!el.frame || !snap.frame) return el.frame === snap.frame
  return Math.abs(el.frame.x - snap.frame.x) <= 4 && Math.abs(el.frame.y - snap.frame.y) <= 40
}

const CANCELLED: WriteOutcome = { ok: false, method: null, reason: 'cancelled' }

export class ChatWriter {
  constructor(private readonly deps: ChatWriterDeps) {}

  async write(req: WriteRequest): Promise<WriteOutcome> {
    const { helper, focus, platform, perception } = this.deps
    if (req.signal?.aborted) return CANCELLED
    const pid =
      req.pid ??
      req.expect?.pid ??
      (req.target === 'chat' ? perception.aiChat()?.pid : null) ??
      focus.previousPid()
    if (pid == null) return this.fallback(req, 'No chat to write into')

    if (req.expect && !platform.isAppActive()) {
      const front = await this.frontmostPid()
      if (front !== pid) return this.changed(req, 'You switched to another app')
    } else if (!(await focus.handBack(pid))) {
      return this.fallback(req, 'Could not switch back to the chat')
    }
    if (req.signal?.aborted) return CANCELLED

    if (req.expect) {
      const focused = await helper.call('ax.focused', {}).catch(() => null)
      if (!sameField(focused, req.expect)) return this.changed(req, 'The text field changed')
    }

    let target: { ref: string | null; point: { x: number; y: number } | null } | null = null
    if (req.target === 'chat') {
      const found = await helper
        .call('ax.findChatInput', { pid, placeholders: CHAT_INPUT_PLACEHOLDERS })
        .catch(() => null)
      if (!found?.found) return this.fallback(req, 'Could not find the chat box')
      target = { ref: found.ref, point: found.frame ? rectCenter(found.frame) : null }
    } else if (req.expect) {
      target = {
        ref: req.expect.ref,
        point: req.expect.frame ? rectCenter(req.expect.frame) : null,
      }
    }
    if (req.signal?.aborted) return CANCELLED

    try {
      const res = await helper.call(
        'input.write',
        {
          text: req.text,
          mode: req.mode,
          target,
          method: 'auto',
          expectPid: pid,
          restoreClipboard: true,
        },
        { timeoutMs: 4000 },
      )
      if (res.ok) return { ok: true, method: res.method, reason: null }
      return this.fallback(req, res.reason ?? 'Writing failed')
    } catch (error) {
      return this.fallback(req, error instanceof Error ? error.message : 'Writing failed')
    }
  }

  /** Copies `text` and tells the user to paste it themselves. */
  copyWithHint(text: string): void {
    this.deps.platform.writeClipboard(text)
    this.deps.notify({
      kind: 'info',
      title: 'Copied — press ⌘V',
      body: 'The prompt is on your clipboard. Click into the chat box and paste it.',
      ttlMs: 8000,
    })
  }

  private fallback(req: WriteRequest, reason: string): WriteOutcome {
    if (req.fallbackToClipboard === false) return { ok: false, method: null, reason }
    this.copyWithHint(req.text)
    return { ok: false, method: 'clipboard', reason }
  }

  /** The context changed while we worked: nothing is written, copying is offered. */
  private changed(req: WriteRequest, reason: string): WriteOutcome {
    this.deps.notify({
      kind: 'info',
      title: 'Nothing written',
      body: `${reason} while I was working.`,
      actions: [
        {
          id: 'copy',
          label: 'Copy instead',
          primary: true,
          run: () => this.deps.platform.writeClipboard(req.text),
        },
      ],
      ttlMs: 10_000,
    })
    return { ok: false, method: null, reason }
  }

  private async frontmostPid(): Promise<number | null> {
    try {
      return (await this.deps.helper.call('frontmost', {}, { timeoutMs: 500 }))?.pid ?? null
    } catch {
      return null
    }
  }
}
