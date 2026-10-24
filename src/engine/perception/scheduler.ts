/**
 * Capture scheduler: the perception tick loop (docs/PLAN.md §6.4 Cadence + Scope + Privacy).
 *
 * Each tick asks the helper how long the user has been idle, picks the cadence, checks the
 * frontmost window against the privacy gate *before* reading it, perceives the frontmost window,
 * and every 3rd tick also the other visible windows. Results go to `onBatch`; pauses (idle, lock,
 * capture switch, helper down) go to `onPause`. Ticks never overlap.
 */
import type { Settings } from '@shared/domain'
import type { FrontmostInfo, PerceivedWindow } from '@shared/helper-protocol'
import type { Cancel, Clock } from '../clock'
import type { HelperClient } from '../contracts'
import { type BlockReason, blockReason, excludedBundleIds } from '../privacy'
import { type CaptureMode, cadenceFor } from './cadence'

export type PauseReason = 'idle' | 'locked' | 'disabled' | 'helper_down'

export interface PerceiveBatch {
  at: number
  idleSeconds: number
  /** What is in front, even when it may not be read. */
  frontmost: FrontmostInfo | null
  frontBlocked: BlockReason | null
  /** The readable frontmost window, when one was perceived. */
  front: PerceivedWindow | null
  /** Other readable visible windows; null on ticks without a visible scan. */
  visible: PerceivedWindow[] | null
}

export interface CaptureSchedulerDeps {
  helper: HelperClient
  clock: Clock
  settings: () => Settings
  onBatch: (batch: PerceiveBatch) => void
  onPause: (reason: PauseReason) => void
  onResume?: () => void
  isLowPower?: () => boolean
  log?: (message: string, error?: unknown) => void
}

export const VISIBLE_EVERY_N_TICKS = 3
const POKE_DELAY_MS = 300
const RETRY_MS = 5000
const MIN_GAP_MS = 100

export class CaptureScheduler {
  private running = false
  private enabled = true
  private locked = false
  private inFlight = false
  private pokeAfterTick = false
  private timer: Cancel | null = null
  private ticks = 0
  private paused: PauseReason | null = null
  private currentMode: CaptureMode | 'off' = 'off'
  /** Exact ids of apps blocked by prefix/keyword rules, learned as they show up. */
  private readonly learnedExclusions = new Set<string>()

  constructor(private readonly deps: CaptureSchedulerDeps) {}

  get mode(): CaptureMode | 'off' {
    return this.currentMode
  }

  isActive(): boolean {
    return this.running && this.paused === null && this.currentMode !== 'off'
  }

  start(): void {
    if (this.running) return
    this.running = true
    this.schedule(0)
  }

  stop(): void {
    this.running = false
    this.cancel()
    this.currentMode = 'off'
    this.paused = null
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
    this.refresh()
  }

  setLocked(locked: boolean): void {
    this.locked = locked
    if (locked) this.pause('locked')
    else this.poke()
  }

  /** Re-reads the switches (capture enabled, cadence) right away, e.g. after a settings change. */
  refresh(): void {
    if (!this.running) return
    if (!this.captureAllowed()) {
      this.cancel()
      this.pause('disabled')
      return
    }
    this.poke()
  }

  /** Tick soon (app switch, unlock, helper reconnect) instead of waiting for the cadence. */
  poke(): void {
    if (!this.running) return
    if (this.inFlight) {
      this.pokeAfterTick = true
      return
    }
    this.schedule(POKE_DELAY_MS)
  }

  /** Runs one tick immediately (used by integration code and tests). */
  async tickNow(): Promise<void> {
    this.cancel()
    await this.tick()
  }

  private captureAllowed(): boolean {
    return this.enabled && this.deps.settings().captureEnabled
  }

  private schedule(ms: number): void {
    this.cancel()
    if (!this.running) return
    this.timer = this.deps.clock.setTimeout(() => {
      this.timer = null
      void this.tick()
    }, ms)
  }

  private cancel(): void {
    this.timer?.()
    this.timer = null
  }

  private pause(reason: PauseReason): void {
    this.currentMode = reason === 'disabled' ? 'off' : 'paused'
    if (this.paused === reason) return
    this.paused = reason
    this.deps.onPause(reason)
  }

  private resume(): void {
    if (this.paused === null) return
    this.paused = null
    this.deps.onResume?.()
  }

  private async tick(): Promise<void> {
    if (!this.running || this.inFlight) return
    if (!this.captureAllowed()) {
      this.pause('disabled')
      return
    }
    this.inFlight = true
    const startedAt = this.deps.clock.now()
    let interval: number = RETRY_MS
    try {
      interval = await this.runTick()
    } catch (error) {
      this.deps.log?.('[perception] tick failed', error)
      if (this.deps.helper.status !== 'connected') this.pause('helper_down')
    } finally {
      this.inFlight = false
    }
    if (!this.running || !this.captureAllowed()) return
    // Fixed rate: the time the helper took counts toward the interval.
    let next = Math.max(MIN_GAP_MS, interval - (this.deps.clock.now() - startedAt))
    if (this.pokeAfterTick) {
      this.pokeAfterTick = false
      next = Math.min(next, POKE_DELAY_MS)
    }
    this.schedule(next)
  }

  /** One capture round; returns the delay until the next tick. */
  private async runTick(): Promise<number> {
    const { helper, clock } = this.deps
    const settings = this.deps.settings()
    const { seconds: idleSeconds } = await helper.call('system.idle', {})
    const cadence = cadenceFor({
      idleSeconds,
      locked: this.locked,
      lowPower: this.deps.isLowPower?.() ?? false,
      activeMs: settings.cadence.activeMs,
      idleMs: settings.cadence.idleMs,
    })
    if (cadence.mode === 'paused') {
      this.pause(this.locked ? 'locked' : 'idle')
      return cadence.intervalMs
    }
    this.resume()
    this.currentMode = cadence.mode
    this.ticks++

    const frontmost = await helper.call('frontmost', {})
    let frontBlocked = frontmost
      ? blockReason(frontmost, frontmost.url, frontmost.windowTitle, settings)
      : null
    if (frontmost && isAppBlock(frontBlocked)) this.learnedExclusions.add(frontmost.bundleId)
    const exclude = [...new Set([...excludedBundleIds(settings), ...this.learnedExclusions])]
    const perceiveParams = { excludeBundleIds: exclude, allowOcr: settings.ocrEnabled }
    let front: PerceivedWindow | null = null
    if (frontmost && !frontBlocked) {
      const res = await helper.call('perceive', { scope: 'frontmost', ...perceiveParams })
      const win = res.windows[0] ?? null
      // The front window may have changed between the two calls: check what we actually got.
      const reason = win ? blockReason(win, win.url, win.title, settings) : null
      if (reason) frontBlocked = reason
      else front = win
    }

    let visible: PerceivedWindow[] | null = null
    const scanVisible = this.ticks % VISIBLE_EVERY_N_TICKS === 0
    // A blocked page in front (bank, private window) skips the scan: it would be read too.
    if (scanVisible && (frontBlocked === null || isAppBlock(frontBlocked))) {
      const res = await helper.call('perceive', { scope: 'visible', ...perceiveParams })
      visible = []
      for (const w of res.windows) {
        const reason = blockReason(w, w.url, w.title, settings)
        if (isAppBlock(reason)) this.learnedExclusions.add(w.bundleId)
        if (reason || (front && sameWindow(w, front))) continue
        if (
          frontmost &&
          frontBlocked &&
          w.pid === frontmost.pid &&
          w.windowId === frontmost.windowId
        ) {
          continue
        }
        visible.push(w)
      }
    }

    this.deps.onBatch({ at: clock.now(), idleSeconds, frontmost, frontBlocked, front, visible })
    return Math.max(cadence.intervalMs, 1)
  }
}

/** Blocked because of the app itself (as opposed to the page or a private window). */
function isAppBlock(reason: BlockReason | null): boolean {
  return reason?.kind === 'app' || reason?.kind === 'user_app'
}

function sameWindow(a: PerceivedWindow, b: PerceivedWindow): boolean {
  return a.pid === b.pid && a.bundleId === b.bundleId && a.windowId === b.windowId
}
