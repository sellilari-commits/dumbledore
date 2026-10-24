/**
 * Opens the SQLite database: creates its folder, sets pragmas (WAL, foreign keys, busy timeout)
 * and runs pending migrations. Works for a file path or ':memory:'.
 */
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { migrate } from './migrations'

export type Db = Database.Database

export interface OpenOptions {
  /** Stamps applied migrations; defaults to the wall clock. */
  nowIso?: string
  readonly?: boolean
}

export function openDatabase(path: string, opts: OpenOptions = {}): Db {
  const inMemory = path === ':memory:' || path === ''
  if (!inMemory) mkdirSync(dirname(path), { recursive: true })
  const db = new Database(path, { readonly: opts.readonly ?? false, timeout: 5000 })
  try {
    if (!inMemory && !opts.readonly) db.pragma('journal_mode = WAL')
    db.pragma('foreign_keys = ON')
    db.pragma('synchronous = NORMAL')
    db.pragma('busy_timeout = 5000')
    if (!opts.readonly) migrate(db, opts.nowIso ?? new Date().toISOString())
    return db
  } catch (error) {
    db.close()
    throw error
  }
}

/** Compiles each SQL string once per connection. */
export function statementCache(db: Db): (sql: string) => Database.Statement {
  const cache = new Map<string, Database.Statement>()
  return (sql) => {
    let stmt = cache.get(sql)
    if (!stmt) {
      stmt = db.prepare(sql)
      cache.set(sql, stmt)
    }
    return stmt
  }
}
