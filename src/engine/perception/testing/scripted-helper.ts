/**
 * Test double for the helper, scoped to what perception uses: `system.idle`, `frontmost` and
 * `perceive` with per-window change detection (unchanged windows come back with `changed:false`
 * and no lines, like the real helper). Tests script the screen by setting `front` / `others`.
 * Lane L1 owns the full FakeHelper; this one stays local to perception tests.
 */
import type {
  FrontmostInfo,
  HelperEvent,
  HelperEventPayload,
  HelperMethod,
  HelperParams,
  HelperResult,
  PerceivedWindow,
  TextLine,
} from '@shared/helper-protocol'
import type { Clock } from '../../clock'
import type { HelperClient, HelperStatus } from '../../contracts'

export type ScriptedLine = string | { text: string; align?: TextLine['align']; conf?: number }

export interface ScriptedWindow {
  pid: number
  bundleId: string
  appName: string
  windowId: number | null
  title: string | null
  url: string | null
  source?: 'ax' | 'ocr'
  lines: ScriptedLine[]
}

export class ScriptedHelper implements HelperClient {
  status: HelperStatus = 'connected'
  idleSeconds = 0
  /** What `ax.selectedText` returns (the student's current selection). */
  selection: string | null = null
  front: ScriptedWindow | null = null
  others: ScriptedWindow[] = []
  /** Methods that throw on their next call (one-shot). */
  failNext = new Set<HelperMethod>()
  readonly calls: { method: HelperMethod; params: unknown; at: number }[] = []
  /** Every window whose text was handed out (to prove blocked windows never were). */
  readonly served: PerceivedWindow[] = []
  private readonly lastHash = new Map<string, string>()

  constructor(private readonly clock: Clock) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  on<E extends HelperEvent>(
    _event: E,
    _listener: (payload: HelperEventPayload<E>) => void,
  ): () => void {
    return () => {}
  }

  onStatus(_listener: (status: HelperStatus) => void): () => void {
    return () => {}
  }

  callsOf(method: HelperMethod): { params: unknown; at: number }[] {
    return this.calls.filter((c) => c.method === method)
  }

  async call<M extends HelperMethod>(method: M, params: HelperParams<M>): Promise<HelperResult<M>> {
    this.calls.push({ method, params, at: this.clock.now() })
    if (this.failNext.delete(method)) throw new Error(`scripted failure: ${method}`)
    return this.handle(method, params) as HelperResult<M>
  }

  private handle(method: HelperMethod, params: unknown): unknown {
    switch (method) {
      case 'system.idle':
        return { seconds: this.idleSeconds }
      case 'frontmost':
        return this.front ? frontmostInfo(this.front) : null
      case 'perceive': {
        const p = params as HelperParams<'perceive'>
        const exclude = new Set(p.excludeBundleIds ?? [])
        const pool = p.scope === 'frontmost' ? [this.front] : [this.front, ...this.others]
        const windows = pool
          .filter((w): w is ScriptedWindow => w !== null && !exclude.has(w.bundleId))
          .map((w) => this.perceived(w))
        return { windows }
      }
      case 'ax.findChatInput':
        return { found: false, frame: null, ref: null, method: null }
      case 'ax.selectedText':
        return { text: this.selection }
      default:
        throw new Error(`ScriptedHelper: ${method} not scripted`)
    }
  }

  private perceived(w: ScriptedWindow): PerceivedWindow {
    const lines: TextLine[] = w.lines.map((l) =>
      typeof l === 'string'
        ? { text: l, conf: w.source === 'ocr' ? 0.95 : 1, box: null, align: 'left' }
        : {
            text: l.text,
            conf: l.conf ?? (w.source === 'ocr' ? 0.95 : 1),
            box: null,
            align: l.align ?? 'left',
          },
    )
    const key = `${w.bundleId}#${w.windowId}`
    const hash = `${w.title}|${w.url}|${lines.map((l) => `${l.align}:${l.text}`).join('\n')}`
    const changed = this.lastHash.get(key) !== hash
    this.lastHash.set(key, hash)
    const win: PerceivedWindow = {
      pid: w.pid,
      bundleId: w.bundleId,
      appName: w.appName,
      windowId: w.windowId,
      title: w.title,
      url: w.url,
      frame: null,
      source: w.source ?? 'ax',
      changed,
      contentHash: String(hash.length),
      lines: changed ? lines : [],
      capturedAt: this.clock.nowIso(),
    }
    if (changed) this.served.push(win)
    return win
  }
}

function frontmostInfo(w: ScriptedWindow): FrontmostInfo {
  return {
    pid: w.pid,
    bundleId: w.bundleId,
    appName: w.appName,
    windowId: w.windowId,
    windowTitle: w.title,
    windowFrame: null,
    isFullScreen: false,
    url: w.url,
  }
}

/** Lets pending promise continuations (helper replies) run. */
export async function flushAsync(): Promise<void> {
  for (let i = 0; i < 5; i++) await new Promise<void>((resolve) => setImmediate(resolve))
}

/** Advances a FakeClock in small steps, letting async ticks finish between steps. */
export async function runFor(
  clock: { advance(ms: number): void },
  ms: number,
  stepMs = 250,
): Promise<void> {
  for (let t = 0; t < ms; t += stepMs) {
    clock.advance(Math.min(stepMs, ms - t))
    await flushAsync()
  }
}
