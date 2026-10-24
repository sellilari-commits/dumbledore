/**
 * "Delete everything" (Settings → Data), file part: removes what holds the student's data —
 * the SQLite database with its WAL/SHM/journal siblings, the per-subject memory files, exports
 * (and the topic text files written there), the memory clean-up's database backups, the
 * remembered chat-box spots and the encrypted API keys. A hand-written `.env.local` stays. Chromium's own storage is in use while the app runs, so the
 * Electron side clears it through the session instead (see delete-all.ts).
 *
 * Never removed: `spend-ledger.jsonl`, the lifetime Gemini spend counter for the student's
 * total budget (written by the brain; no personal data). Wiping it would reset the budget, so
 * the wipe refuses any path that is, or contains, a kept file.
 */
import { existsSync, rmSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import type { AppPaths } from '../paths'

export function dataFiles(paths: AppPaths): string[] {
  const db = paths.dbFile
  return [
    db,
    `${db}-wal`,
    `${db}-shm`,
    `${db}-journal`,
    paths.memoryDir,
    paths.exportsDir,
    // Full copies of the database made by the memory clean-up (engine/store/cleanup/cli.ts).
    join(paths.dataDir, 'backups'),
    join(paths.dataDir, 'chat-spots.json'),
    paths.secretsFile,
  ]
}

/** Files that survive "Delete everything". */
export function keptFiles(paths: AppPaths): string[] {
  return [paths.spendLedgerFile]
}

/** Removes every data file that exists and returns the removed paths. */
export function wipeDataFiles(paths: AppPaths): string[] {
  const kept = keptFiles(paths).map((path) => resolve(path))
  const protects = (path: string) => {
    const target = resolve(path)
    return kept.some((k) => k === target || k.startsWith(target + sep))
  }
  const removed: string[] = []
  for (const path of dataFiles(paths)) {
    if (protects(path) || !existsSync(path)) continue
    rmSync(path, { recursive: true, force: true })
    removed.push(path)
  }
  return removed
}
