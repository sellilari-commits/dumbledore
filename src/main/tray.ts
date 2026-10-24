/**
 * Menu-bar icon (template image) and its menu: Open Dumbledore ⌃⌥⌘D · End study session (while
 * one runs) · Pause capture ⌃⌥⌘P · Hide orb · Settings · Quit. The same items back the orb's
 * right-click menu. The chords are registered globally (shortcuts.ts); the menu only shows them.
 */
import { Menu, type MenuItemConstructorOptions, nativeImage, Tray } from 'electron'
import { trayIconPngs } from './tray-icon'

export interface TrayActions {
  openApp: () => void
  openSettings: () => void
  toggleCapture: () => void
  toggleOrb: () => void
  quit: () => void
  isCapturing: () => boolean
  isOrbVisible: () => boolean
  /** Ends the running study session; the item shows only while isStudying(). */
  endSession?: () => void
  isStudying?: () => boolean
}

export function menuTemplate(a: TrayActions): MenuItemConstructorOptions[] {
  return [
    {
      label: 'Open Dumbledore',
      accelerator: 'Control+Alt+Command+D',
      registerAccelerator: false,
      click: a.openApp,
    },
    ...(a.endSession && a.isStudying?.()
      ? [{ label: 'End study session', click: a.endSession }]
      : []),
    {
      label: a.isCapturing() ? 'Pause capture' : 'Resume capture',
      accelerator: 'Control+Alt+Command+P',
      registerAccelerator: false,
      click: a.toggleCapture,
    },
    { label: a.isOrbVisible() ? 'Hide orb' : 'Show orb', click: a.toggleOrb },
    { label: 'Settings…', click: a.openSettings },
    { type: 'separator' },
    { label: 'Quit Dumbledore', click: a.quit },
  ]
}

export function trayImage(): Electron.NativeImage {
  const { x1, x2 } = trayIconPngs()
  const image = nativeImage.createFromBuffer(x1, { scaleFactor: 1 })
  image.addRepresentation({ scaleFactor: 2, buffer: x2 })
  image.setTemplateImage(true)
  return image
}

export class AppTray {
  private readonly tray: Tray

  constructor(private readonly actions: TrayActions) {
    this.tray = new Tray(trayImage())
    this.tray.setToolTip('Dumbledore')
    this.refresh()
  }

  /** Rebuild after capture / orb visibility changed (labels flip). */
  refresh(): void {
    this.tray.setContextMenu(Menu.buildFromTemplate(menuTemplate(this.actions)))
  }

  popupOrbMenu(): void {
    Menu.buildFromTemplate(menuTemplate(this.actions)).popup()
  }

  destroy(): void {
    this.tray.destroy()
  }
}
