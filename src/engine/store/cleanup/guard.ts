/**
 * Is Dumbledore running on this data folder? Offline tools that rewrite the database must not run
 * next to the app. Signals, any of which counts:
 * - Electron's `SingletonLock` in the data folder (the app's userData) naming a live app process;
 * - `run/test-control.json` naming a live app process;
 * - another process holding the database, its -wal/-shm files or `run/helper.sock` open (lsof).
 * Stale files left by a crash or a kill don't count: their process is gone or isn't the app.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readlinkSync } from 'node:fs'
import { join } from 'node:path'
import type { DataPaths } from '../paths'

export interface RunningApp {
  pid: number
  reason: string
}

export interface GuardProbes {
  /** Command name of a live process, or null when there is none. */
  processName(pid: number): string | null
  /** Pids of processes holding any of the files open. */
  holders(files: string[]): number[]
}

const APP_PROCESS = /dumbledore|electron/i

export const systemProbes: GuardProbes = {
  processName(pid) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EPERM') return null
    }
    try {
      return execFileSync('ps', ['-p', String(pid), '-o', 'comm='], { encoding: 'utf8' }).trim()
    } catch {
      return null
    }
  },
  holders(files) {
    if (files.length === 0) return []
    try {
      const out = execFileSync('lsof', ['-t', '--', ...files], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      return out.split(/\s+/).filter(Boolean).map(Number)
    } catch (error) {
      // lsof exits 1 when no process has the files open.
      const out = (error as { stdout?: string }).stdout ?? ''
      return out.split(/\s+/).filter(Boolean).map(Number)
    }
  },
}

function lockPid(root: string): number | null {
  try {
    const target = readlinkSync(join(root, 'SingletonLock')) // "<host>-<pid>"
    const pid = Number(target.slice(target.lastIndexOf('-') + 1))
    return Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

function controlPid(runDir: string): number | null {
  try {
    const pid = (
      JSON.parse(readFileSync(join(runDir, 'test-control.json'), 'utf8')) as { pid?: unknown }
    ).pid
    return typeof pid === 'number' && Number.isInteger(pid) && pid > 0 ? pid : null
  } catch {
    return null
  }
}

export function findRunningApp(
  paths: DataPaths,
  probes: GuardProbes = systemProbes,
): RunningApp | null {
  const candidates: [number | null, string][] = [
    [lockPid(paths.root), 'SingletonLock'],
    [controlPid(paths.runDir), 'run/test-control.json'],
  ]
  for (const [pid, file] of candidates) {
    if (pid === null || pid === process.pid) continue
    const name = probes.processName(pid)
    if (name && APP_PROCESS.test(name)) return { pid, reason: `${file} names live process ${name}` }
  }
  const files = ['', '-wal', '-shm'].map((s) => `${paths.dbFile}${s}`)
  files.push(paths.helperSocket)
  const holders = probes.holders(files.filter((f) => existsSync(f)))
  const pid = holders.find((p) => p !== process.pid)
  if (pid !== undefined) {
    const name = probes.processName(pid) ?? 'unknown process'
    return { pid, reason: `${name} has the database or helper socket open` }
  }
  return null
}
