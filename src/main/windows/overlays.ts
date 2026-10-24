/**
 * The overlay windows: one transparent, full-screen, click-through panel per display (Goldfish's
 * approach), loading overlay.html?display=<id>, hidden from screen sharing. Recreated when
 * displays are added, removed or change size, and when a renderer crashes. The page reports its
 * hit areas ('hover'), and `setInteractive` toggles click-through for that display.
 */
import {
  BrowserWindow,
  type BrowserWindowConstructorOptions,
  type Rectangle,
  screen,
} from 'electron'
import type { DisplayInfo } from '../overlay/geometry'
import { finishOverlay, overlayOptions } from './options'
import { pageUrl } from './urls'

export interface OverlayWindowsOptions {
  devUrl: string | null
  prefs: BrowserWindowConstructorOptions['webPreferences']
  register: (win: BrowserWindow, displayId: number) => void
  onDisplays: (displays: DisplayInfo[]) => void
}

const rect = (r: Rectangle) => ({ x: r.x, y: r.y, width: r.width, height: r.height })

export function currentDisplays(): DisplayInfo[] {
  const primary = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d) => ({
    id: d.id,
    bounds: rect(d.bounds),
    workArea: rect(d.workArea),
    primary: d.id === primary,
  }))
}

export class OverlayWindows {
  private readonly windows = new Map<number, BrowserWindow>()
  private visible = true
  private syncTimer: ReturnType<typeof setTimeout> | null = null
  private started = false

  constructor(private readonly opts: OverlayWindowsOptions) {}

  start(): void {
    if (this.started) return
    this.started = true
    this.sync()
    screen.on('display-added', this.scheduleSync)
    screen.on('display-removed', this.scheduleSync)
    screen.on('display-metrics-changed', this.scheduleSync)
  }

  stop(): void {
    screen.off('display-added', this.scheduleSync)
    screen.off('display-removed', this.scheduleSync)
    screen.off('display-metrics-changed', this.scheduleSync)
    if (this.syncTimer) clearTimeout(this.syncTimer)
    for (const win of this.windows.values()) if (!win.isDestroyed()) win.destroy()
    this.windows.clear()
    this.started = false
  }

  all(): BrowserWindow[] {
    return [...this.windows.values()].filter((w) => !w.isDestroyed())
  }

  get(displayId: number): BrowserWindow | undefined {
    const win = this.windows.get(displayId)
    return win && !win.isDestroyed() ? win : undefined
  }

  isVisible(): boolean {
    return this.visible
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    for (const win of this.all()) {
      if (visible) win.showInactive()
      else win.hide()
    }
  }

  /** After app.hide(): put the overlays back on screen without activating the app. */
  restore(): void {
    if (!this.visible) return
    for (const win of this.all()) if (!win.isVisible()) win.showInactive()
  }

  /** Clickable while the pointer is over a hit area; click-through otherwise. */
  setInteractive(displayId: number | null, interactive: boolean): void {
    const targets = displayId === null ? this.all() : [this.get(displayId)]
    for (const win of targets) win?.setIgnoreMouseEvents(!interactive, { forward: true })
  }

  private readonly scheduleSync = (): void => {
    if (this.syncTimer) clearTimeout(this.syncTimer)
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null
      this.sync()
    }, 250)
  }

  private sync(): void {
    const displays = currentDisplays()
    const ids = new Set(displays.map((d) => d.id))
    for (const [id, win] of this.windows) {
      if (ids.has(id)) continue
      if (!win.isDestroyed()) win.destroy()
      this.windows.delete(id)
    }
    for (const d of displays) {
      const existing = this.get(d.id)
      if (existing) existing.setBounds(d.bounds)
      else this.windows.set(d.id, this.create(d))
    }
    this.opts.onDisplays(displays)
  }

  private create(d: DisplayInfo): BrowserWindow {
    const win = new BrowserWindow(overlayOptions(d.bounds, this.opts.prefs))
    finishOverlay(win)
    this.opts.register(win, d.id)
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return
      win.setBounds(d.bounds)
      if (this.visible) win.showInactive()
    })
    win.webContents.on('render-process-gone', (_event, details) => {
      console.error(`[overlay] renderer for display ${d.id} gone: ${details.reason}`)
      if (details.reason === 'clean-exit') return
      setTimeout(() => {
        if (this.windows.get(d.id) !== win) return
        if (!win.isDestroyed()) win.destroy()
        this.windows.delete(d.id)
        this.sync()
      }, 1000)
    })
    void win
      .loadURL(pageUrl('overlay', { query: { display: String(d.id) } }, this.opts.devUrl))
      .catch((error: unknown) => console.error('[overlay] load failed', error))
    return win
  }
}
