/**
 * Helper client (lane L1): the real socket client, a scriptable fake, fixtures and a recorder.
 *
 *   import { createHelperClient } from '@engine/helper'
 *   const helper = createHelperClient({ mode: 'dev', repoRoot })   // spawns native/helper/build/dumbledore-helper
 *   await helper.start()
 */

import { SocketHelperClient } from './client'
import type { LogFn } from './launcher'
import {
  appLauncher,
  defaultSocketPath,
  devHelperPaths,
  packagedHelperAppPath,
  spawnLauncher,
} from './launcher'

export { SocketHelperClient, type SocketHelperClientOptions } from './client'
export { HelperClientErrorCode, HelperRpcError, isHelperRpcError } from './errors'
export { HelperEventHub } from './events'
export { type FakeCall, FakeHelper, type ParsedParams, type Responder } from './fake'
export { defaultResult, type HelperFixture, loadFixture, parseFixture } from './fixtures'
export {
  appLauncher,
  defaultSocketPath,
  devHelperPaths,
  externalLauncher,
  HELPER_EXIT_ALREADY_RUNNING,
  type HelperLauncher,
  type LaunchedHelper,
  type LogFn,
  packagedHelperAppPath,
  spawnLauncher,
} from './launcher'
export { HelperRecorder } from './recorder'

/**
 * Convenience factory for the shell.
 * - `dev`: spawns the raw executable from native/helper/build (inherits this process's permissions).
 * - `packaged`: opens the helper app embedded in the main bundle (its own permissions).
 */
export function createHelperClient(
  opts:
    | { mode: 'dev'; repoRoot: string; socketPath?: string; verbose?: boolean; log?: LogFn }
    | { mode: 'packaged'; mainAppBundle: string; socketPath?: string; log?: LogFn },
): SocketHelperClient {
  const socketPath = opts.socketPath ?? defaultSocketPath()
  const launcher =
    opts.mode === 'dev'
      ? spawnLauncher({
          executable: devHelperPaths(opts.repoRoot).executable,
          verbose: opts.verbose,
          log: opts.log,
        })
      : appLauncher({ appPath: packagedHelperAppPath(opts.mainAppBundle), log: opts.log })
  return new SocketHelperClient({ launcher, socketPath, log: opts.log })
}
