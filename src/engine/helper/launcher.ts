/**
 * How the helper process gets started, and where its files live.
 *
 * - `spawnLauncher` (development): runs the raw executable as a child process. The child inherits
 *   this process's macOS permissions (the terminal / IDE grants Accessibility + Screen Recording).
 * - `appLauncher` (packaged): `open -n -g -a "Dumbledore Helper.app" --args …`, so macOS ties the
 *   permissions to the helper's own bundle id.
 * - `externalLauncher`: something else starts the helper; the client only connects (tests, debugging).
 *
 * Every launcher passes `--socket <path> --parent-pid <our pid>`: the helper exits when we do.
 */
import { type ChildProcess, spawn } from 'node:child_process'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { DATA_DIR_NAME, HELPER_APP_NAME, HELPER_SOCKET_NAME, RUN_DIR_NAME } from '@shared/constants'

export interface LaunchedHelper {
  /** Process id when known (spawn mode); the client also learns it from `ping`. */
  readonly pid: number | null
  /** Resolves with the exit code when the launched process exits; null when not tracked. */
  readonly exited: Promise<number | null> | null
  kill(signal?: NodeJS.Signals): void
}

export interface HelperLauncher {
  readonly kind: 'spawn' | 'app' | 'external'
  launch(socketPath: string): Promise<LaunchedHelper>
}

export type LogFn = (level: 'debug' | 'info' | 'warn' | 'error', message: string) => void

/** Exit code the helper uses when another helper already listens on the socket. */
export const HELPER_EXIT_ALREADY_RUNNING = 75

/** Longest Unix socket path macOS accepts (sun_path is 104 bytes including the NUL). */
export const MAX_SOCKET_PATH_BYTES = 103

export function defaultSocketPath(home: string = homedir()): string {
  return join(
    home,
    'Library',
    'Application Support',
    DATA_DIR_NAME,
    RUN_DIR_NAME,
    HELPER_SOCKET_NAME,
  )
}

/** Build outputs of native/helper/build.sh, relative to the repository root. */
export function devHelperPaths(repoRoot: string): { executable: string; app: string } {
  const build = join(repoRoot, 'native', 'helper', 'build')
  return {
    executable: join(build, 'dumbledore-helper'),
    app: join(build, `${HELPER_APP_NAME}.app`),
  }
}

/** Where the packaged app embeds the helper (decided in WP9; adjust here if it moves). */
export function packagedHelperAppPath(mainAppBundle: string): string {
  return join(mainAppBundle, 'Contents', 'Library', 'LoginItems', `${HELPER_APP_NAME}.app`)
}

function helperArgs(socketPath: string, extra: string[]): string[] {
  return ['--socket', socketPath, '--parent-pid', String(process.pid), ...extra]
}

function trackChild(child: ChildProcess, log?: LogFn): LaunchedHelper {
  const exited = new Promise<number | null>((resolve) => {
    child.once('exit', (code) => resolve(code))
    child.once('error', (error) => {
      log?.('error', `helper process error: ${error.message}`)
      resolve(null)
    })
  })
  return {
    pid: child.pid ?? null,
    exited,
    kill: (signal = 'SIGTERM') => {
      if (child.exitCode === null && child.signalCode === null) child.kill(signal)
    },
  }
}

function forwardLines(stream: NodeJS.ReadableStream | null, onLine: (line: string) => void): void {
  if (!stream) return
  let pending = ''
  stream.setEncoding('utf8')
  stream.on('data', (chunk: string) => {
    pending += chunk
    const lines = pending.split('\n')
    pending = lines.pop() ?? ''
    for (const line of lines) if (line.trim()) onLine(line)
  })
}

export function spawnLauncher(opts: {
  executable: string
  args?: string[]
  verbose?: boolean
  env?: NodeJS.ProcessEnv
  log?: LogFn
}): HelperLauncher {
  return {
    kind: 'spawn',
    async launch(socketPath) {
      const extra = [...(opts.args ?? []), ...(opts.verbose ? ['--verbose'] : [])]
      const child = spawn(opts.executable, helperArgs(socketPath, extra), {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: opts.env ?? process.env,
      })
      forwardLines(child.stderr, (line) => opts.log?.('debug', line))
      forwardLines(child.stdout, (line) => opts.log?.('debug', `helper: ${line}`))
      return trackChild(child, opts.log)
    },
  }
}

export function appLauncher(opts: {
  appPath: string
  args?: string[]
  log?: LogFn
}): HelperLauncher {
  return {
    kind: 'app',
    async launch(socketPath) {
      const child = spawn(
        'open',
        ['-n', '-g', '-a', opts.appPath, '--args', ...helperArgs(socketPath, opts.args ?? [])],
        {
          stdio: ['ignore', 'ignore', 'pipe'],
        },
      )
      forwardLines(child.stderr, (line) => opts.log?.('warn', `open: ${line}`))
      const code = await new Promise<number | null>((resolve) => {
        child.once('exit', resolve)
        child.once('error', () => resolve(null))
      })
      if (code !== 0) throw new Error(`could not open ${opts.appPath} (exit ${code})`)
      // `open` returns at once; the helper's own pid comes from `ping`.
      return { pid: null, exited: null, kill: () => {} }
    },
  }
}

export function externalLauncher(): HelperLauncher {
  return {
    kind: 'external',
    async launch() {
      return { pid: null, exited: null, kill: () => {} }
    },
  }
}
