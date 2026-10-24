/**
 * Where Dumbledore keeps its data: `~/Library/Application Support/Dumbledore/` holding the SQLite
 * database, `memory/` (per-subject Markdown files) and `run/` (the helper socket, owner-only).
 *
 * The root is injectable for tests; `DUMBLEDORE_DATA_DIR` overrides it for E2E runs.
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  DATA_DIR_NAME,
  DB_FILE_NAME,
  HELPER_SOCKET_NAME,
  MEMORY_DIR_NAME,
  RUN_DIR_NAME,
} from '@shared/constants'

export const DATA_DIR_ENV = 'DUMBLEDORE_DATA_DIR'

export interface DataPaths {
  root: string
  dbFile: string
  memoryDir: string
  runDir: string
  helperSocket: string
}

export interface ResolveOptions {
  /** Explicit data folder (tests). Wins over the environment and the default. */
  root?: string
  /** Home folder used for the default location. */
  home?: string
  env?: Record<string, string | undefined>
}

export function defaultDataRoot(home: string = homedir()): string {
  return join(home, 'Library', 'Application Support', DATA_DIR_NAME)
}

export function resolveDataPaths(opts: ResolveOptions = {}): DataPaths {
  const env = opts.env ?? process.env
  const root = opts.root ?? (env[DATA_DIR_ENV] || defaultDataRoot(opts.home))
  const runDir = join(root, RUN_DIR_NAME)
  return {
    root,
    dbFile: join(root, DB_FILE_NAME),
    memoryDir: join(root, MEMORY_DIR_NAME),
    runDir,
    helperSocket: join(runDir, HELPER_SOCKET_NAME),
  }
}

/** Creates the folders (idempotent). `run/` is chmod 0700 so only this user can reach the socket. */
export function ensureDataDirs(paths: DataPaths): DataPaths {
  mkdirSync(paths.root, { recursive: true })
  mkdirSync(paths.memoryDir, { recursive: true })
  mkdirSync(paths.runDir, { recursive: true, mode: 0o700 })
  chmodSync(paths.runDir, 0o700)
  return paths
}
