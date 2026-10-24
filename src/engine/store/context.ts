/** Shared plumbing for the SQLite repositories: statements, clock, search index, small helpers. */
import type Database from 'better-sqlite3'
import type { Db } from './db'
import type { SearchIndex } from './search-index'

export interface StoreCtx {
  db: Db
  stmt: (sql: string) => Database.Statement
  now: () => string
  index: SearchIndex
}

/** Throws the same message shape as the in-memory twin ("subject sub_x not found"). */
export function must<T>(value: T | null | undefined, what: string): T {
  if (value === null || value === undefined) throw new Error(`${what} not found`)
  return value
}

export function seqOf(ctx: StoreCtx, table: string, id: string): number | null {
  const seq = ctx.stmt(`SELECT seq FROM ${table} WHERE id = ?`).pluck().get(id)
  return seq === undefined ? null : Number(seq)
}

/** SQLite LIMIT for an optional JS limit (undefined → no limit; negatives clamp to 0). */
export const sqlLimit = (limit: number | undefined): number =>
  limit === undefined || !Number.isFinite(limit) ? -1 : Math.max(0, Math.floor(limit))
