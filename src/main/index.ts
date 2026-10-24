/**
 * Bootstrap placeholder. Lane L7 (shell) replaces this with the real shell: windows, tray,
 * IPC handlers and the composition root that wires the engine together.
 */
import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'

function createAppWindow(): void {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    titleBarStyle: 'hiddenInset',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })
  const devUrl = process.env.ELECTRON_RENDERER_URL
  if (devUrl) void win.loadURL(`${devUrl}/app.html`)
  else void win.loadFile(join(__dirname, '../renderer/app.html'))
}

void app.whenReady().then(createAppWindow)
app.on('window-all-closed', () => app.quit())
