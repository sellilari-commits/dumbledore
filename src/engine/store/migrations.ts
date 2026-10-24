/**
 * Versioned schema migrations, embedded as SQL strings so the packaged app needs no files.
 *
 * `schema_version` records every applied migration. Each migration runs in its own transaction;
 * a database written by a newer app version (unknown higher version) is refused rather than
 * silently downgraded. To change the schema, append a migration — never edit an applied one.
 */
import type BetterSqlite3 from 'better-sqlite3'
import { SCHEMA_V1 } from './schema-v1'
import { SCHEMA_V2 } from './schema-v2'

type Db = BetterSqlite3.Database

export interface Migration {
  version: number
  name: string
  sql: string
}

export const MIGRATIONS: readonly Migration[] = [
  { version: 1, name: 'initial schema', sql: SCHEMA_V1 },
  { version: 2, name: 'notes and concept edges', sql: SCHEMA_V2 },
]

export const LATEST_SCHEMA_VERSION = MIGRATIONS.reduce((max, m) => Math.max(max, m.version), 0)

export function currentSchemaVersion(db: Db): number {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_version').get() as
    | { version: number | null }
    | undefined
  return row?.version ?? 0
}

/**
 * Applies pending migrations and returns the versions applied in this call.
 * `nowIso` stamps `schema_version.applied_at`.
 */
export function migrate(
  db: Db,
  nowIso: string,
  migrations: readonly Migration[] = MIGRATIONS,
): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const latest = migrations.reduce((max, m) => Math.max(max, m.version), 0)
  const current = currentSchemaVersion(db)
  if (current > latest) {
    throw new Error(
      `database schema v${current} is newer than this app understands (v${latest}); update Dumbledore`,
    )
  }
  const record = db.prepare(
    'INSERT INTO schema_version (version, name, applied_at) VALUES (?, ?, ?)',
  )
  const applied: number[] = []
  for (const m of [...migrations].sort((a, b) => a.version - b.version)) {
    if (m.version <= current) continue
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.version, m.name, nowIso)
    })()
    applied.push(m.version)
  }
  return applied
}
