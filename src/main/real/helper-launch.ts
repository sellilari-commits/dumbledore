/**
 * The real helper client for composeReal: a SocketHelperClient on the data folder's socket
 * (`run/helper.sock`), started by the launcher that fits how Dumbledore runs.
 *
 * - `dev`: spawns native/helper/build/dumbledore-helper (build it with `npm run helper:build`);
 *   it inherits the terminal's Accessibility / Screen Recording permissions.
 * - `packaged`: opens the helper app embedded in Dumbledore.app (its own permissions).
 * - `external`: only connects; something else runs the helper (Xcode, a terminal).
 *   `DUMBLEDORE_HELPER=external` picks this mode when the shell passes no launch mode.
 */
import {
  appLauncher,
  devHelperPaths,
  externalLauncher,
  type HelperLauncher,
  type LogFn,
  packagedHelperAppPath,
  SocketHelperClient,
  spawnLauncher,
} from '@engine/helper'

export type HelperLaunch =
  | { mode: 'dev'; repoRoot: string; verbose?: boolean }
  | { mode: 'packaged'; mainAppBundle: string }
  | { mode: 'external' }

/** Default when the shell passes nothing: external if asked for, else dev from `cwd`. */
export function launchFromEnv(env: Record<string, string | undefined>, cwd: string): HelperLaunch {
  return env.DUMBLEDORE_HELPER?.trim() === 'external'
    ? { mode: 'external' }
    : { mode: 'dev', repoRoot: cwd }
}

export function launcherFor(launch: HelperLaunch, log?: LogFn): HelperLauncher {
  switch (launch.mode) {
    case 'dev':
      return spawnLauncher({
        executable: devHelperPaths(launch.repoRoot).executable,
        verbose: launch.verbose,
        log,
      })
    case 'packaged':
      return appLauncher({ appPath: packagedHelperAppPath(launch.mainAppBundle), log })
    case 'external':
      return externalLauncher()
  }
}

export function createRealHelper(
  launch: HelperLaunch,
  socketPath: string,
  log?: LogFn,
): SocketHelperClient {
  return new SocketHelperClient({ launcher: launcherFor(launch, log), socketPath, log })
}

/**
 * Waits for `start` at most `ms` (real time): a helper that is slow to come up must not hold up
 * the app; everything follows 'helper:status' anyway.
 */
export async function startWithin(start: Promise<void>, ms: number): Promise<void> {
  let cancel = () => {}
  const limit = new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms)
    timer.unref?.()
    cancel = () => clearTimeout(timer)
  })
  try {
    await Promise.race([start.catch(() => undefined), limit])
  } finally {
    cancel()
  }
}
