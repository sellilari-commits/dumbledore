/**
 * Where Dumbledore keeps its files: ~/Library/Application Support/Dumbledore (override with
 * DUMBLEDORE_DATA_DIR, e.g. for E2E runs), with the private run/ folder (0700) for the helper
 * socket and the test-control file, and Chromium's own data in a subfolder. The database and
 * memory-file names match the store's (engine/store/paths.ts).
 */
import { chmodSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DATA_DIR_NAME, DB_FILE_NAME, MEMORY_DIR_NAME, RUN_DIR_NAME } from '@shared/constants'

export interface AppPaths {
  dataDir: string
  runDir: string
  chromiumDir: string
  secretsFile: string
  /** SQLite database (with -wal / -shm siblings). */
  dbFile: string
  /** Per-subject Markdown memory files. */
  memoryDir: string
  /** "Export everything" files. */
  exportsDir: string
  /** Lifetime Gemini spend counter (brain lane). Survives "Delete everything". */
  spendLedgerFile: string
}

export const SPEND_LEDGER_FILE_NAME = 'spend-ledger.jsonl'

export function resolvePaths(appDataDir: string, env: NodeJS.ProcessEnv = process.env): AppPaths {
  const dataDir = env.DUMBLEDORE_DATA_DIR?.trim() || join(appDataDir, DATA_DIR_NAME)
  return {
    dataDir,
    runDir: join(dataDir, RUN_DIR_NAME),
    chromiumDir: join(dataDir, 'chromium'),
    secretsFile: join(dataDir, 'secrets.json'),
    dbFile: join(dataDir, DB_FILE_NAME),
    memoryDir: join(dataDir, MEMORY_DIR_NAME),
    exportsDir: join(dataDir, 'exports'),
    spendLedgerFile: join(dataDir, SPEND_LEDGER_FILE_NAME),
  }
}

export function ensureDirs(paths: AppPaths): void {
  mkdirSync(paths.dataDir, { recursive: true, mode: 0o700 })
  mkdirSync(paths.runDir, { recursive: true, mode: 0o700 })
  chmodSync(paths.runDir, 0o700)
}
