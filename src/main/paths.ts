/**
 * Where Dumbledore keeps its files: ~/Library/Application Support/Dumbledore (override with
 * DUMBLEDORE_DATA_DIR, e.g. for E2E runs), with the private run/ folder (0700) for the helper
 * socket and the test-control file, and Chromium's own data in a subfolder.
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR_NAME, RUN_DIR_NAME } from '@shared/constants'

export interface AppPaths {
  dataDir: string
  runDir: string
  chromiumDir: string
  secretsFile: string
}

export function resolvePaths(appDataDir: string, env: NodeJS.ProcessEnv = process.env): AppPaths {
  const dataDir = env.DUMBLEDORE_DATA_DIR?.trim() || join(appDataDir, DATA_DIR_NAME)
  return {
    dataDir,
    runDir: join(dataDir, RUN_DIR_NAME),
    chromiumDir: join(dataDir, 'chromium'),
    secretsFile: join(dataDir, 'secrets.json'),
  }
}

export function ensureDirs(paths: AppPaths): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  mkdirSync(paths.runDir, { recursive: true, mode: 0o700 })
  chmodSync(paths.runDir, 0o700)
}
