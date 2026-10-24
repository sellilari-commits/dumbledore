/**
 * Small BrowserWindow effects shared by the window manager: injecting key presses into a page
 * that never has focus (the overlay's quiz card, the ask bar) and refreshing the native shadow
 * of a transparent window after its content changed size.
 */
import type { BrowserWindow } from 'electron'

/** The native shadow is computed from the page's pixels, so wait for the repaint. */
const SHADOW_DELAY_MS = 60

/** keyDown (+ char for printable keys) + keyUp, as Electron key codes ("1", "Return", "Escape"). */
export function sendKey(win: BrowserWindow, keyCode: string): void {
  if (win.isDestroyed()) return
  win.webContents.sendInputEvent({ type: 'keyDown', keyCode })
  if (keyCode.length === 1) win.webContents.sendInputEvent({ type: 'char', keyCode })
  win.webContents.sendInputEvent({ type: 'keyUp', keyCode })
}

/** Transparent windows with a native shadow (the ask bar) recompute it after repainting. */
export function refreshShadow(win: BrowserWindow): void {
  if (process.platform !== 'darwin' || !win.hasShadow()) return
  setTimeout(() => {
    if (!win.isDestroyed()) win.invalidateShadow()
  }, SHADOW_DELAY_MS)
}
