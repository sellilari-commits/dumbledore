/**
 * Electron capabilities the pure shell modules (router, ChatWriter, flows) need. Injected so
 * those modules never import Electron and run in plain Vitest; the Electron implementations live
 * in app.ts and windows/.
 */
import type { Rect } from '@shared/geometry'

export interface ShellPlatform {
  /** Dumbledore's own pid (the Electron main process is the app process). */
  readonly ownPid: number
  /** True while one of our windows has keyboard focus, i.e. Dumbledore is the active app. */
  isAppActive(): boolean
  /** `app.hide()`: macOS then activates the app that was active before us. */
  hideApp(): void
  /** Shows the overlay windows again after a hide (they must stay on screen). */
  restoreOverlays(): void
  writeClipboard(text: string): void
  sleep(ms: number): Promise<void>
}

export type WindowSurface = 'panel' | 'askbar' | 'app'

export interface OpenOptions {
  route?: string | null
  /** Ask bar: place it over this focused field (global points) instead of centring it. */
  nearField?: Rect | null
}

/** Opening and closing Dumbledore's own windows. Typing surfaces hand focus back on close. */
export interface SurfaceControl {
  isOpen(surface: WindowSurface): boolean
  open(surface: WindowSurface, opts?: OpenOptions): Promise<void>
  close(surface: WindowSurface): Promise<void>
  /** Delivers an Enter key press to the ask bar, or to the overlay (its quiz card). */
  pressEnter(surface: 'askbar' | 'overlay'): void
}
