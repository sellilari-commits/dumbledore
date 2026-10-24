/**
 * Electron lifecycle and wiring: data paths, the renderer protocol and CSP, the composition root,
 * the window manager, the shell core, IPC, tray, global shortcuts and (in tests) the
 * test-control channel. Dumbledore is an agent app: no Dock icon unless the full app is open,
 * and closing every window never quits it.
 *
 * The services come from `composeReal()` (src/main/real, the real engine). Test mode and
 * DUMBLEDORE_FAKES=1 use `compose()` instead: fakes with demo data.
 */
import { join, resolve } from 'node:path'
import { APP_NAME } from '@shared/constants'
import { app, clipboard, ipcMain, shell } from 'electron'
import { compose } from './compose'
import { deleteEverything } from './data/delete-all'
import { watchRenderer } from './diagnostics'
import { Broadcaster } from './ipc/broadcast'
import { StateBroadcast, wireBroadcasts } from './ipc/events'
import { createHandlers } from './ipc/handlers'
import { registerIpc } from './ipc/register'
import { type AppPaths, ensureDirs, resolvePaths } from './paths'
import type { ShellPlatform } from './platform'
import { composeReal } from './real/compose-real'
import { SafeStorageSecretStore } from './secrets'
import { configureSession, harden } from './security'
import { createShellCore, type ShellCore } from './shell'
import { GlobalShortcuts } from './shortcuts'
import { createTestControlApi } from './test-control/api'
import { TestControlServer } from './test-control/server'
import { AppTray } from './tray'
import { WindowManager } from './windows/manager'
import { registerSchemePrivileges } from './windows/protocol'

const isTest = process.env.DUMBLEDORE_TEST === '1'
const useFakes = isTest || process.env.DUMBLEDORE_FAKES === '1'
const devUrl = app.isPackaged ? null : process.env.ELECTRON_RENDERER_URL || null

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
  app.on('web-contents-created', (_event, contents) => {
    harden(contents, devUrl)
    if (!app.isPackaged) watchRenderer(contents)
  })
  app
    .whenReady()
    .then(() => start(paths))
    .catch((error: unknown) => {
      console.error('[dumbledore] failed to start', error)
      app.exit(1)
    })
}

async function start(paths: AppPaths): Promise<void> {
  if (process.platform === 'darwin') app.setActivationPolicy('accessory')
  configureSession(devUrl, join(__dirname, '../renderer'))

  const secrets = isTest ? undefined : new SafeStorageSecretStore(paths.secretsFile)
  const real = useFakes
    ? null
    : composeReal({
        dataDir: paths.dataDir,
        secrets,
        launch: app.isPackaged
          ? { mode: 'packaged', mainAppBundle: resolve(process.execPath, '../../..') }
          : undefined,
      })
  const composition = real ?? compose({ ownPid: process.pid, secrets })
  const { services } = composition
  /** Stops the services; the real engine also closes its database. */
  const shutdown = () => (real ? real.close() : services.stop())
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
    tap: () => {
      broadcaster.emit('key.gesture', { gesture: 'tap', key: 'fallbackChord' })
      if (services.repos.settings.get().onboardingDone) void ref.core?.router.gesture('tap')
    },
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
    onOverlayChange: (state) => {
      broadcaster.emit('overlay.changed', state)
      // Tests send quiz keys through test-control instead of grabbing the real keyboard.
      if (!isTest) shortcuts.setQuizKeys(state.quiz !== null, (key) => windows.forwardKey(key))
    },
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
    exportDir: paths.exportsDir,
    revealFile: (path) => shell.showItemInFolder(path),
    deleteAllData: () => deleteEverything({ paths, stopServices: shutdown, relaunch: !isTest }),
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
  console.log(
    `[dumbledore] ready: ${windows.overlays.all().length} overlay window(s), tray icon, ` +
      `helper ${services.helper.status}, data in ${paths.dataDir}`,
  )

  let testControl: TestControlServer | null = null
  // DUMBLEDORE_CONTROL=1 also opens it on the real engine, to drive dev runs from scripts.
  if (isTest || process.env.DUMBLEDORE_CONTROL === '1') {
    testControl = new TestControlServer(
      createTestControlApi({
        core,
        handlers,
        fakes: composition.fakes,
        windows: () => ({ ...windows.summary(), tray: tray !== null }),
        forwardKey: (key) => windows.forwardKey(key),
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
    void shutdown()
  })
}
