/**
 * Row codecs: a thin typed layer between domain objects (camelCase) and SQLite rows (snake_case).
 *
 * Each field is declared once with its storage kind; the codec derives column names, named
 * parameters for prepared statements, and the row → object decoding. JSON columns hold arrays
 * and objects, booleans are stored as 0/1, and SQL NULL maps to `null`.
 */

export type FieldKind = 'text' | 'num' | 'bool' | 'json'
export type Row = Record<string, unknown>
export type Params = Record<string, unknown>

/** Same rule as the in-memory twin: trimmed, lower-cased, inner whitespace collapsed. */
export const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

export const snake = (key: string): string => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)

export function encodeValue(kind: FieldKind, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'bool':
      return value ? 1 : 0
    case 'json':
      return JSON.stringify(value)
    default:
      return value
  }
}

export function decodeValue(kind: FieldKind, value: unknown): unknown {
  if (value === null || value === undefined) return null
  switch (kind) {
    case 'bool':
      return value === 1 || value === true
    case 'json':
      return JSON.parse(String(value))
    case 'num':
      return Number(value)
    default:
      return value
  }
}

export interface Codec<T> {
  /** Domain keys in declaration order. */
  readonly keys: readonly (keyof T & string)[]
  /** Column name per domain key. */
  readonly columns: readonly string[]
  /** Named parameters (`@column`) for every field, ready for an INSERT. */
  params(value: T): Params
  /** Named parameters for the given subset of fields (undefined values are skipped). */
  patchParams(patch: Partial<T>): Params
  decode(row: Row): T
  kindOf(key: keyof T & string): FieldKind
}

export function codec<T>(spec: { [K in keyof T]-?: FieldKind }): Codec<T> {
  const keys = Object.keys(spec) as (keyof T & string)[]
  const kinds = spec as Record<string, FieldKind>
  const columns = keys.map(snake)
  const kindOf = (key: string): FieldKind => {
    const kind = kinds[key]
    if (!kind) throw new Error(`unknown field "${key}"`)
    return kind
  }
  return {
    keys,
    columns,
    kindOf,
    params(value) {
      const out: Params = {}
      const record = value as Record<string, unknown>
      for (const key of keys) out[snake(key)] = encodeValue(kindOf(key), record[key])
      return out
    },
    patchParams(patch) {
      const out: Params = {}
      for (const [key, value] of Object.entries(patch as Record<string, unknown>)) {
        if (value === undefined || !(key in kinds)) continue
        out[snake(key)] = encodeValue(kindOf(key), value)
      }
      return out
    },
    decode(row) {
      const out: Record<string, unknown> = {}
      for (const key of keys) out[key] = decodeValue(kindOf(key), row[snake(key)])
      return out as T
    },
  }
}

/** `INSERT INTO table (a, b) VALUES (@a, @b)` for the codec's columns plus extra columns. */
export function insertSql(table: string, columns: readonly string[]): string {
  return `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map((c) => `@${c}`).join(', ')})`
}

/** `UPDATE table SET a = @a, b = @b WHERE <where>` for the given columns. */
export function updateSql(table: string, columns: readonly string[], where: string): string {
  return `UPDATE ${table} SET ${columns.map((c) => `${c} = @${c}`).join(', ')} WHERE ${where}`
}
