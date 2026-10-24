/**
 * Focus hand-back for typing surfaces (PLAN §4 D7). Electron cannot take typing without
 * activating the app (#52915), so the ask bar and the panel activate Dumbledore briefly. They
 * remember the app that was frontmost when they opened, and give focus back to it when they
 * close or before anything is written: app.hide() → helper app.activate(pid) → verify.
 */
import type { HelperClient } from '@engine/contracts'
import type { ShellPlatform } from '../platform'

const VERIFY_TRIES = 8
const VERIFY_INTERVAL_MS = 60

export class FocusKeeper {
  private previous: number | null = null

  constructor(
    private readonly helper: HelperClient,
    private readonly platform: ShellPlatform,
  ) {}

  /** Remembers the frontmost app (unless it is us). Call before a typing surface takes focus. */
  async remember(): Promise<number | null> {
    const front = await this.frontmostPid()
    if (front !== null && front !== this.platform.ownPid) this.previous = front
    return this.previous
  }

  previousPid(): number | null {
    return this.previous
  }

  forget(): void {
    this.previous = null
  }

  /**
   * Makes `pid` (default: the remembered app) frontmost again. Only hides Dumbledore when it is
   * the active app; returns true once the helper confirms `pid` is frontmost.
   */
  async handBack(pid: number | null = this.previous): Promise<boolean> {
    const active = this.platform.isAppActive()
    if (active) this.platform.hideApp()
    if (pid === null) {
      if (active) this.platform.restoreOverlays()
      return false
    }
    try {
      if (active || (await this.frontmostPid()) !== pid) {
        await this.helper.call('app.activate', { pid }, { timeoutMs: 800 })
      }
    } catch {
      // verification below decides
    }
    let ok = false
    for (let i = 0; i < VERIFY_TRIES; i++) {
      if ((await this.frontmostPid()) === pid) {
        ok = true
        break
      }
      await this.platform.sleep(VERIFY_INTERVAL_MS)
    }
    if (active) this.platform.restoreOverlays()
    return ok
  }

  private async frontmostPid(): Promise<number | null> {
    try {
      const front = await this.helper.call('frontmost', {}, { timeoutMs: 500 })
      return front?.pid ?? null
    } catch {
      return null
    }
  }
}
