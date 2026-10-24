/**
 * BrowserWindow options per surface, following the overlay spike on this Mac (PLAN §3.4):
 * non-activating panels for the overlay (focusable:false, shown with showInactive), focusable
 * panels for typing surfaces, and a normal window for the full app. All renderers are sandboxed
 * with context isolation and no Node integration.
 */
import type { BrowserWindow, BrowserWindowConstructorOptions, Rectangle } from 'electron'

export function webPreferences(
  preload: string,
  devTools: boolean,
): BrowserWindowConstructorOptions['webPreferences'] {
  return {
    preload,
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
    nodeIntegrationInWorker: false,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    spellcheck: false,
    devTools,
  }
}

/** One transparent, click-through, full-screen panel per display. Never takes focus. */
export function overlayOptions(
  bounds: Rectangle,
  prefs: BrowserWindowConstructorOptions['webPreferences'],
): BrowserWindowConstructorOptions {
  return {
    type: 'panel',
    ...bounds,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    roundedCorners: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    focusable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    enableLargerThanScreen: true,
    title: 'Dumbledore overlay',
    webPreferences: { ...prefs, backgroundThrottling: false },
  }
}

/** Calls that must follow construction (they have no constructor option). */
export function finishOverlay(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
  win.setIgnoreMouseEvents(true, { forward: true })
  win.setContentProtection(true)
}

/**
 * Panel and ask bar: frameless, transparent corners (the page draws the card), focusable. Both
 * want the native shadow, which follows the card's shape (invalidateShadow after resizes).
 */
export function typingOptions(
  size: { width: number; height: number },
  prefs: BrowserWindowConstructorOptions['webPreferences'],
  title: string,
  shadow = false,
): BrowserWindowConstructorOptions {
  return {
    type: 'panel',
    width: size.width,
    height: size.height,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: shadow,
    roundedCorners: false,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    acceptFirstMouse: true,
    hiddenInMissionControl: true,
    title,
    webPreferences: prefs,
  }
}

export function finishTyping(win: BrowserWindow): void {
  win.setAlwaysOnTop(true, 'floating')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
}

/** The full app: 1200×800, hidden title bar with the traffic lights over the sidebar. */
export function appOptions(
  prefs: BrowserWindowConstructorOptions['webPreferences'],
  dark: boolean,
): BrowserWindowConstructorOptions {
  return {
    width: 1200,
    height: 800,
    minWidth: 880,
    minHeight: 560,
    show: false,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 16, y: 16 },
    backgroundColor: dark ? '#191919' : '#FFFFFF',
    title: 'Dumbledore',
    webPreferences: prefs,
  }
}
