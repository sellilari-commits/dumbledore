/**
 * The FTS5 search index (table `search_fts`, trigram tokenizer, case-sensitive over text that is
 * already normalizeName()-d). A trigram phrase query is a substring match, so results equal the
 * in-memory twin's `includes()` search. Queries shorter than 3 characters can't use trigrams and
 * fall back to a scan with instr().
 *
 * Row ids encode the source: rowid = seq * 4 + kind, where seq is the entity's INTEGER PRIMARY KEY.
 */

import { normalizeName } from './codec'
import type { Db } from './db'

export const SEARCH_KINDS = ['subject', 'concept', 'encounter', 'exam'] as const
export type SearchKind = (typeof SEARCH_KINDS)[number]

export interface SearchRef {
  kind: SearchKind
  seq: number
}

export interface SearchIndex {
  /** Indexes up to three text fields of an entity (replacing what was there). */
  put(kind: SearchKind, seq: number, fields: readonly (string | null | undefined)[]): void
  remove(kind: SearchKind, seq: number): void
  /** Matching entities ordered by kind (subject, concept, encounter, exam), then insertion. */
  match(q: string): SearchRef[]
}

const rowIdOf = (kind: SearchKind, seq: number): number => seq * 4 + SEARCH_KINDS.indexOf(kind)

export function createSearchIndex(db: Db): SearchIndex {
  const del = db.prepare('DELETE FROM search_fts WHERE rowid = ?')
  const ins = db.prepare('INSERT INTO search_fts (rowid, f1, f2, f3) VALUES (?, ?, ?, ?)')
  const phrase = db.prepare('SELECT rowid FROM search_fts WHERE search_fts MATCH ?').pluck()
  const scan = db
    .prepare(
      'SELECT rowid FROM search_fts WHERE instr(f1, @q) > 0 OR instr(f2, @q) > 0 OR instr(f3, @q) > 0',
    )
    .pluck()

  return {
    put(kind, seq, fields) {
      const [f1, f2, f3] = [0, 1, 2].map((i) => {
        const value = fields[i]
        return value ? normalizeName(value) : null
      })
      const rowid = rowIdOf(kind, seq)
      del.run(rowid)
      ins.run(rowid, f1, f2, f3)
    },
    remove(kind, seq) {
      del.run(rowIdOf(kind, seq))
    },
    match(q) {
      const n = normalizeName(q)
      if (!n) return []
      const rowids = (
        [...n].length >= 3 ? phrase.all(`"${n.replaceAll('"', '""')}"`) : scan.all({ q: n })
      ) as number[]
      return rowids
        .map((rowid) => {
          const r = Number(rowid)
          return { kind: SEARCH_KINDS[r % 4] as SearchKind, seq: Math.floor(r / 4), order: r % 4 }
        })
        .sort((a, b) => a.order - b.order || a.seq - b.seq)
        .map(({ kind, seq }) => ({ kind, seq }))
    },
  }
}
