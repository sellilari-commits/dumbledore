/**
 * Electron lifecycle and wiring: data paths, the renderer protocol and CSP, the composition root,
 * the window manager, the shell core, IPC, tray, global shortcuts and (in tests) the
 * test-control channel. Dumbledore is an agent app: no Dock icon unless the full app is open,
 * and closing every window never quits it.
 */
import { join } from 'node:path'
import { APP_NAME } from '@shared/constants'
import { app, clipboard, ipcMain, session, shell, type WebContents } from 'electron'
import { compose } from './compose'
import { Broadcaster } from './ipc/broadcast'
import { StateBroadcast, wireBroadcasts } from './ipc/events'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { type AppPaths, ensureDirs, resolvePaths } from './paths'
import type { ShellPlatform } from './platform'
import { SafeStorageSecretStore } from './secrets'
import { createShellCore, type ShellCore } from './shell'
import { GlobalShortcuts } from './shortcuts'
import { createTestControlApi } from './test-control/api'
import { TestControlServer } from './test-control/server'
import { AppTray } from './tray'
import { WindowManager } from './windows/manager'
import { registerSchemePrivileges, serveRenderer } from './windows/protocol'
import { devCsp, isOwnUrl, rendererBase } from './windows/urls'

const isTest = process.env.DUMBLEDORE_TEST === '1'
const devUrl = app.isPackaged ? null : (process.env.ELECTRON_RENDERER_URL ?? null)

const SYSTEM_SETTINGS = {
  accessibility: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  screenRecording: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
} as const

let windowsRef: WindowManager | null = null

/** Runs synchronously at import time of the main entry, before the app is ready. */
export function bootstrap(): void {
  app.setName(APP_NAME)
  const paths = resolvePaths(app.getPath('appData'))
  ensureDirs(paths)
  app.setPath('userData', paths.dataDir)
  app.setPath('sessionData', paths.chromiumDir)
  registerSchemePrivileges()
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return
  }
  app.on('second-instance', () => void windowsRef?.open('app'))
  app.on('activate', () => void windowsRef?.open('app'))
  app.on('window-all-closed', () => {
    // Agent app: keep running with the orb and the menu-bar icon.
  })
  app.on('web-contents-created', (_event, contents) => harden(contents))
  app
    .whenReady()
    .then(() => start(paths))
    .catch((error: unknown) => {
      console.error('[dumbledore] failed to start', error)
      app.exit(1)
    })
}

/** No new windows, no navigation away from our pages, no webviews; https links open outside. */
function harden(contents: WebContents): void {
  const openOutside = (url: string) => {
    if (/^https:\/\//i.test(url)) void shell.openExternal(url)
  }
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (isOwnUrl(url, devUrl)) return
    event.preventDefault()
    openOutside(url)
  })
  contents.on('will-attach-webview', (event) => event.preventDefault())
}

function configureSession(): void {
  const ses = session.defaultSession
  const allowed = new Set(['clipboard-sanitized-write'])
  ses.setPermissionRequestHandler((_wc, permission, callback) => callback(allowed.has(permission)))
  ses.setPermissionCheckHandler((_wc, permission) => allowed.has(permission))
  if (devUrl) {
    const csp = devCsp(devUrl)
    ses.webRequest.onHeadersReceived({ urls: [`${rendererBase(devUrl)}/*`] }, (details, done) => {
      done({ responseHeaders: { ...details.responseHeaders, 'Content-Security-Policy': [csp] } })
    })
  } else {
    serveRenderer(join(__dirname, '../renderer'))
  }
}

async function start(paths: AppPaths): Promise<void> {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  configureSession()

  const composition = compose({
    ownPid: process.pid,
    secrets: isTest ? undefined : new SafeStorageSecretStore(paths.secretsFile),
  })
  const { services } = composition
  const windows = new WindowManager({
    preloadPath: join(__dirname, '../preload/index.js'),
    devUrl,
    devTools: !app.isPackaged,
    test: isTest,
  })
  windowsRef = windows
  const broadcaster = new Broadcaster(windows, !app.isPackaged)
  let tray: AppTray | null = null
  const ref: { core: ShellCore | null } = { core: null }
  const shortcuts = new GlobalShortcuts({
    tap: () => void ref.core?.router.gesture('tap'),
    toggleCapture: () => toggleCapture(),
    openApp: () => void windows.open('app'),
  })
  const platform: ShellPlatform = {
    ownPid: process.pid,
    isAppActive: () => windows.ownWindowFocused(),
    hideApp: () => app.hide(),
    restoreOverlays: () => windows.overlays.restore(),
    writeClipboard: (text) => clipboard.writeText(text),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  }
  const stateBroadcast = new StateBroadcast(
    () => core.appState(),
    (state) => broadcaster.emit('state.changed', state),
  )
  const core = createShellCore(services, {
    platform,
    surfaces: windows,
    version: app.getVersion(),
    onOverlayChange: (state) => broadcaster.emit('overlay.changed', state),
    onChatDelta: (delta) => broadcaster.emit('chat.delta', delta),
    onBusy: (busy) => shortcuts.setEscape(busy, () => core.router.cancel()),
    onAppStateChange: () => {
      stateBroadcast.schedule()
      tray?.refresh()
    },
  })
  ref.core = core
  windows.bind({ focus: core.focus, overlay: core.overlay, helper: services.helper })

  const handlers = createHandlers(core, {
    openSystemSettings: (kind) => shell.openExternal(SYSTEM_SETTINGS[kind]),
    setOverlayInteractive: (displayId, on) => windows.overlays.setInteractive(displayId, on),
    showOrbMenu: () => tray?.popupOrbMenu(),
    setWindowSize: (surface, width, height) => windows.setSize(surface, width, height),
  })
  const unregister = registerIpc(ipcMain, handlers, {
    identify: windows.identify,
    validateResponses: !app.isPackaged,
    onError: (channel, error) => console.warn(`[ipc] ${channel} failed:`, error),
  })
  const unwire = wireBroadcasts(services.bus, broadcaster)
  const appCtx = { surface: 'app' as const, displayId: null }
  const toggleCapture = () =>
    void handlers['capture.setEnabled'](!services.repos.settings.get().captureEnabled, appCtx)
  const toggleOrb = () => {
    const orb = services.repos.settings.get().orb
    void handlers['settings.update']({ orb: { ...orb, visible: !orb.visible } }, appCtx)
  }
  services.bus.on('settings:changed', ({ settings }) => {
    windows.overlays.setVisible(settings.orb.visible)
    shortcuts.setFallback(settings.shortcut.fallbackChord)
    tray?.refresh()
  })

  core.start()
  await services.start()
  const settings = services.repos.settings.get()
  windows.overlays.setVisible(settings.orb.visible)
  windows.overlays.start()
  tray = new AppTray({
    openApp: () => void windows.open('app'),
    openSettings: () => void windows.open('app', { route: '/settings/general' }),
    toggleCapture,
    toggleOrb,
    quit: () => app.quit(),
    isCapturing: () => services.repos.settings.get().captureEnabled,
    isOrbVisible: () => services.repos.settings.get().orb.visible,
  })
  shortcuts.start(settings.shortcut.fallbackChord)

  let testControl: TestControlServer | null = null
  if (isTest) {
    testControl = new TestControlServer(
      createTestControlApi({
        core,
        handlers,
        fakes: composition.fakes,
        windows: () => windows.summary(),
      }),
      join(paths.runDir, 'test-control.json'),
    )
    const info = await testControl.start()
    console.log(`[test-control] listening on 127.0.0.1:${info.port}`)
  }

  app.on('before-quit', () => {
    shortcuts.stop()
    unwire()
    unregister()
    core.dispose()
    void testControl?.stop()
    tray?.destroy()
    tray = null
    windows.destroyAll()
    void services.stop()
  })
}
