/**
 * Window manager: overlays (via OverlayWindows), the mini panel, the ask bar and the full app.
 *
 * - Implements SurfaceControl for the shell and EventSink for broadcasts, and identifies IPC
 *   senders (only our own webContents are answered).
 * - Typing surfaces (panel, ask bar) remember the previous frontmost app when they open,
 *   activate Dumbledore so typing works (#52915), hide on blur, and hand focus back on close.
 * - The app window is created on demand and destroyed on close; the Dock icon shows only while
 *   it is open (accessory activation policy otherwise).
 * - The overlay never has focus, so quiz-card keys are injected into it (`forwardKey`).
 */
import type { HelperClient } from '@engine/contracts'
import { CHAT_PANEL_HEIGHT, chatPanelSize, isPromptRoute } from '@shared/chat-panel'
import type { Surface } from '@shared/constants'
import { type Rect, rectCenter } from '@shared/geometry'
import { IPC_EVENT_PREFIX } from '@shared/ipc'
import { app, BrowserWindow, nativeTheme, screen } from 'electron'
import type { FocusKeeper } from '../chat/focus-keeper'
import type { EventSink } from '../ipc/broadcast'
import type { InvokeContext } from '../ipc/types'
import type { OverlayController } from '../overlay/controller'
import { type DisplayInfo, displayAt, primaryDisplay } from '../overlay/geometry'
import type { OpenOptions, SurfaceControl, WindowSurface } from '../platform'
import { refreshShadow, sendKey } from './native'
import { appOptions, finishTyping, typingOptions, webPreferences } from './options'
import { OverlayWindows } from './overlays'
import {
  ASKBAR_SIZE,
  askbarOpenBounds,
  PANEL_SIZE,
  panelBounds,
  panelOpenSize,
  resizeKeepingTop,
} from './placement'
import { pageUrl } from './urls'

export interface WindowManagerOptions {
  preloadPath: string
  devUrl: string | null
  devTools: boolean
  /** Test mode: typing surfaces do not hide on blur (the test runner owns focus). */
  test: boolean
}

export interface WindowBindings {
  focus: FocusKeeper
  overlay: OverlayController
  helper: HelperClient
}

type TypingSurface = 'panel' | 'askbar'
const BLUR_GRACE_MS = 400

export class WindowManager implements SurfaceControl, EventSink {
  readonly overlays: OverlayWindows
  private readonly typing: Record<TypingSurface, BrowserWindow | null> = {
    panel: null,
    askbar: null,
  }
  private appWin: BrowserWindow | null = null
  /** Route the ask bar was last opened on (null = the double-tap chat). */
  private askbarRouteOpened: string | null = null
  /** The mini panel's last content-fitted size; it reopens at it (null until it first fits). */
  private panelFitted: { width: number; height: number } | null = null
  private readonly senders = new Map<number, InvokeContext>()
  private readonly ready = new WeakSet<BrowserWindow>()
  private readonly shownAt = new WeakMap<BrowserWindow, number>()
  private bindings: WindowBindings | null = null

  constructor(private readonly opts: WindowManagerOptions) {
    this.overlays = new OverlayWindows({
      devUrl: opts.devUrl,
      prefs: this.prefs(),
      register: (win, displayId) => this.register(win, 'overlay', displayId),
      onDisplays: (displays) => this.bindings?.overlay.setDisplays(displays),
    })
  }

  bind(bindings: WindowBindings): void {
    this.bindings = bindings
  }

  // ─── IPC plumbing ───────────────────────────────────────────────────────────────────────

  readonly identify = (event: { sender: unknown }): InvokeContext | null => {
    const id = (event.sender as { id?: unknown } | null)?.id
    return typeof id === 'number' ? (this.senders.get(id) ?? null) : null
  }

  send(surfaces: readonly Surface[], channel: string, payload: unknown): void {
    for (const surface of surfaces) {
      for (const win of this.windowsOf(surface)) {
        if (!win.isDestroyed()) win.webContents.send(channel, payload)
      }
    }
  }

  // ─── SurfaceControl ─────────────────────────────────────────────────────────────────────

  isOpen(surface: WindowSurface): boolean {
    const win = surface === 'app' ? this.appWin : this.typing[surface]
    return !!win && !win.isDestroyed() && win.isVisible()
  }

  askbarRoute(): 'chat' | 'prompt' | null {
    if (!this.isOpen('askbar')) return null
    return isPromptRoute(this.askbarRouteOpened) ? 'prompt' : 'chat'
  }

  async open(surface: WindowSurface, opts: OpenOptions = {}): Promise<void> {
    if (surface === 'app') return this.openApp(opts.route ?? null)
    // The ask bar always hears its route on open (no route = the chat).
    if (surface === 'askbar') this.askbarRouteOpened = opts.route ?? null
    const win = this.ensureTyping(surface, opts.route ?? null)
    win.setBounds(await this.placement(surface, opts))
    await this.showTyping(win)
  }

  async close(surface: WindowSurface): Promise<void> {
    if (surface === 'app') {
      this.appWin?.close()
      return
    }
    const win = this.typing[surface]
    if (!win || win.isDestroyed() || !win.isVisible()) return
    const hadFocus = win.isFocused()
    win.hide()
    if (hadFocus && !this.ownWindowFocused()) await this.bindings?.focus.handBack()
  }

  pressEnter(surface: 'askbar' | 'overlay'): void {
    const targets = surface === 'askbar' ? [this.typing.askbar] : this.overlays.all()
    for (const win of targets) if (win) sendKey(win, 'Return')
  }

  /** Quiz-card keys (1–4, Return, Escape) for the overlays; only the card's page reacts. */
  forwardKey(keyCode: string): void {
    for (const win of this.overlays.all()) sendKey(win, keyCode)
  }

  // ─── Shell helpers ──────────────────────────────────────────────────────────────────────

  /** True while one of our windows has keyboard focus (Dumbledore is the active app). */
  ownWindowFocused(): boolean {
    return BrowserWindow.getFocusedWindow() !== null
  }

  setSize(surface: TypingSurface, width: number, height: number): void {
    const win = this.typing[surface]
    if (!win || win.isDestroyed()) return
    const w = Math.round(Math.min(Math.max(width, 280), 800))
    const h = Math.round(
      Math.min(Math.max(height, 44), surface === 'askbar' ? Math.max(CHAT_PANEL_HEIGHT, 600) : 900),
    )
    const current = win.getBounds()
    const area = displayAt(this.displays(), rectCenter(current))?.workArea ?? current
    if (surface === 'panel') this.panelFitted = { width: w, height: h }
    win.setBounds(resizeKeepingTop(current, w, h, area))
    refreshShadow(win)
  }

  displays(): DisplayInfo[] {
    return this.bindings?.overlay.displayList() ?? []
  }

  /** What is on screen, for the test-control channel. */
  summary(): Record<string, unknown> {
    const info = (win: BrowserWindow | null) =>
      win && !win.isDestroyed()
        ? { visible: win.isVisible(), bounds: win.getBounds(), url: win.webContents.getURL() }
        : null
    return {
      overlays: this.overlays.all().map(info),
      panel: info(this.typing.panel),
      askbar: info(this.typing.askbar),
      app: info(this.appWin),
    }
  }

  destroyAll(): void {
    this.overlays.stop()
    for (const win of [this.typing.panel, this.typing.askbar, this.appWin]) {
      if (win && !win.isDestroyed()) win.destroy()
    }
  }

  // ─── internals ──────────────────────────────────────────────────────────────────────────

  private prefs() {
    return webPreferences(this.opts.preloadPath, this.opts.devTools)
  }

  private register(win: BrowserWindow, surface: Surface, displayId: number | null): void {
    const id = win.webContents.id
    this.senders.set(id, { surface, displayId })
    win.once('ready-to-show', () => this.ready.add(win))
    win.on('closed', () => this.senders.delete(id))
  }

  private windowsOf(surface: Surface): BrowserWindow[] {
    if (surface === 'overlay') return this.overlays.all()
    const win = surface === 'app' ? this.appWin : this.typing[surface]
    return win && !win.isDestroyed() ? [win] : []
  }

  private ensureTyping(surface: TypingSurface, route: string | null): BrowserWindow {
    const existing = this.typing[surface]
    if (existing && !existing.isDestroyed()) {
      // The Ask bar always hears its route, so a reused window leaves the study box for the chat.
      if (route || surface === 'askbar')
        existing.webContents.send(`${IPC_EVENT_PREFIX}navigate`, { route: route ?? '/' })
      return existing
    }
    const size = surface === 'panel' ? PANEL_SIZE : ASKBAR_SIZE
    const title = surface === 'panel' ? 'Dumbledore' : 'Ask Dumbledore'
    const win = new BrowserWindow(typingOptions(size, this.prefs(), title, true))
    finishTyping(win)
    this.register(win, surface, null)
    win.on('blur', () => this.onTypingBlur(win))
    win.on('closed', () => {
      if (this.typing[surface] === win) this.typing[surface] = null
    })
    this.typing[surface] = win
    void win
      .loadURL(pageUrl(surface, { route }, this.opts.devUrl))
      .catch((error: unknown) => console.error(`[${surface}] load failed`, error))
    return win
  }

  private async placement(surface: TypingSurface, opts: OpenOptions): Promise<Rect> {
    const displays = this.displays()
    if (surface === 'panel') {
      const anchor = this.bindings?.overlay.anchor() ?? null
      const display = displays.find((d) => d.id === anchor?.displayId) ?? primaryDisplay(displays)
      const size = panelOpenSize(opts.route ?? null, this.panelFitted)
      if (anchor && display) return panelBounds(display, anchor, size)
      return { x: 100, y: 100, ...size }
    }
    const prompt = isPromptRoute(opts.route)
    const anchor = this.bindings?.overlay.anchor() ?? null
    // The double-tap chat stands beside the orb; the study box goes to the active display.
    const display = prompt
      ? await this.activeDisplay(opts.nearField ?? null, displays)
      : displays.find((d) => d.id === anchor?.displayId)
    const target = display ?? primaryDisplay(displays)
    if (!target) return { x: 100, y: 100, ...(prompt ? ASKBAR_SIZE : chatPanelSize(900)) }
    return askbarOpenBounds(target, opts.route, anchor, opts.nearField ?? null)
  }

  /** The display of the focused field, else of the frontmost window, else under the pointer. */
  private async activeDisplay(
    near: Rect | null,
    displays: DisplayInfo[],
  ): Promise<DisplayInfo | undefined> {
    if (near) return displayAt(displays, rectCenter(near))
    const helper = this.bindings?.helper
    if (helper?.status === 'connected') {
      try {
        const front = await helper.call('frontmost', {}, { timeoutMs: 300 })
        if (front?.windowFrame && front.pid !== process.pid) {
          return displayAt(displays, rectCenter(front.windowFrame))
        }
      } catch {
        // fall back to the pointer
      }
    }
    return displayAt(displays, screen.getCursorScreenPoint())
  }

  private async showTyping(win: BrowserWindow): Promise<void> {
    if (!this.ownWindowFocused()) await this.bindings?.focus.remember()
    const show = () => {
      if (win.isDestroyed()) return
      this.shownAt.set(win, Date.now())
      app.focus({ steal: true })
      win.show()
      win.focus()
      refreshShadow(win)
    }
    if (this.ready.has(win)) show()
    else win.once('ready-to-show', show)
  }

  private onTypingBlur(win: BrowserWindow): void {
    if (this.opts.test) return
    if (Date.now() - (this.shownAt.get(win) ?? 0) < BLUR_GRACE_MS) return
    setTimeout(() => {
      if (!win.isDestroyed() && win.isVisible() && !win.isFocused()) win.hide()
    }, 120)
  }

  private openApp(route: string | null): void {
    const existing = this.appWin
    if (existing && !existing.isDestroyed()) {
      if (route) existing.webContents.send(`${IPC_EVENT_PREFIX}navigate`, { route })
      this.showApp(existing)
      return
    }
    if (process.platform === 'darwin') {
      app.setActivationPolicy('regular')
      void app.dock?.show()
    }
    const win = new BrowserWindow(appOptions(this.prefs(), nativeTheme.shouldUseDarkColors))
    this.appWin = win
    this.register(win, 'app', null)
    win.once('ready-to-show', () => this.showApp(win))
    win.on('closed', () => {
      if (this.appWin === win) this.appWin = null
      this.onAppClosed()
    })
    void win
      .loadURL(pageUrl('app', { route: route ?? '/home' }, this.opts.devUrl))
      .catch((error: unknown) => console.error('[app] load failed', error))
  }

  private showApp(win: BrowserWindow): void {
    if (win.isDestroyed()) return
    app.focus({ steal: true })
    win.show()
    win.focus()
  }

  private onAppClosed(): void {
    if (process.platform !== 'darwin') return
    app.dock?.hide()
    app.setActivationPolicy('accessory')
    if (!this.ownWindowFocused()) {
      app.hide()
      this.overlays.restore()
    }
  }
}
