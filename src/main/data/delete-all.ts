/**
 * Electron side of "Delete everything": stop background work (the composition releases the
 * store), clear Chromium's storage (localStorage, caches), wipe the data files, then relaunch so
 * the app starts like a first run (onboarding). The exit waits a moment so the IPC reply reaches
 * the window first. Test runs quit instead of relaunching (the runner owns the process).
 */
import { app, session } from 'electron'
import type { AppPaths } from '../paths'
import { wipeDataFiles } from './wipe'

const EXIT_DELAY_MS = 250

export interface DeleteAllOptions {
  paths: AppPaths
  stopServices: () => Promise<void>
  relaunch: boolean
}

export async function deleteEverything(opts: DeleteAllOptions): Promise<void> {
  try {
    await opts.stopServices()
  } catch (error) {
    console.warn('[data] stopping services before the wipe failed', error)
  }
  await session.defaultSession.clearStorageData()
  const removed = wipeDataFiles(opts.paths)
  console.log(
    `[data] deleted ${removed.length} data file(s); ${opts.relaunch ? 'relaunching' : 'quitting'}`,
  )
  setTimeout(() => {
    if (opts.relaunch) app.relaunch()
    app.exit(0)
  }, EXIT_DELAY_MS)
}
