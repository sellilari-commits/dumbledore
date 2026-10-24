/**
 * Scrubbing secrets out of what is already stored (the privacy fix of 2026-10-25: a TextEdit
 * window showing a .env file was read, and a selected API key became a note).
 *
 * Everything that came from a window showing a secret file (episodes, their encounters, notes)
 * is deleted outright, notes included (a note's own delete only marks it). Everywhere else the
 * stored text is passed through `mask`, and changed rows are re-indexed for search.
 */
import type { StoreCtx } from './context'

export interface ScrubReport {
  /** Rows whose text was masked. */
  masked: number
  removedEpisodes: number
  removedEncounters: number
  removedNotes: number
}

export interface ScrubSupport {
  secrets(opts: {
    mask: (text: string) => string
    isSecretTitle: (title: string | null) => boolean
  }): ScrubReport
}

type Row = Record<string, unknown> & { seq: number; id: string }

const titleOf = (source: unknown): string | null => {
  try {
    const parsed = JSON.parse(String(source ?? 'null')) as { title?: unknown } | null
    return typeof parsed?.title === 'string' ? parsed.title : null
  } catch {
    return null
  }
}

const listOf = (json: unknown): string[] => {
  try {
    const v = JSON.parse(String(json ?? '[]'))
    return Array.isArray(v) ? v.map(String) : []
  } catch {
    return []
  }
}

export function createScrub(ctx: StoreCtx): ScrubSupport {
  const { db, index } = ctx
  const all = (sql: string) => db.prepare(sql).all() as Row[]

  return {
    secrets({ mask, isSecretTitle }) {
      const report: ScrubReport = {
        masked: 0,
        removedEpisodes: 0,
        removedEncounters: 0,
        removedNotes: 0,
      }
      db.transaction(() => {
        // 1. Whatever came from a secret file's window goes entirely.
        const badEpisodes = new Set(
          all('SELECT seq, id, title FROM episodes')
            .filter((r) => isSecretTitle((r.title as string | null) ?? null))
            .map((r) => r.id),
        )
        const badEncounters = all('SELECT seq, id, episode_id, source FROM encounters').filter(
          (r) => badEpisodes.has(String(r.episode_id)) || isSecretTitle(titleOf(r.source)),
        )
        const badEncounterIds = new Set(badEncounters.map((r) => r.id))
        for (const note of all('SELECT seq, id, encounter_id, source FROM notes')) {
          if (
            !badEncounterIds.has(String(note.encounter_id)) &&
            !isSecretTitle(titleOf(note.source))
          )
            continue
          db.prepare('DELETE FROM notes WHERE id = ?').run(note.id)
          index.remove('note', Number(note.seq))
          report.removedNotes++
        }
        for (const enc of badEncounters) {
          db.prepare('DELETE FROM encounters WHERE id = ?').run(enc.id)
          index.remove('encounter', Number(enc.seq))
          report.removedEncounters++
        }
        for (const id of badEpisodes) {
          db.prepare('DELETE FROM episodes WHERE id = ?').run(id)
          report.removedEpisodes++
        }

        // 2. Mask secrets everywhere else.
        const maskColumns = (table: string, columns: string[], reindex?: (row: Row) => void) => {
          const rows = all(`SELECT seq, id, ${columns.join(', ')} FROM ${table}`)
          for (const row of rows) {
            const changed: Record<string, string> = {}
            for (const c of columns) {
              const v = row[c]
              if (typeof v !== 'string' || !v) continue
              const m = mask(v)
              if (m !== v) changed[c] = m
            }
            const keys = Object.keys(changed)
            if (keys.length === 0) continue
            db.prepare(
              `UPDATE ${table} SET ${keys.map((k) => `${k} = @${k}`).join(', ')} WHERE id = @id`,
            ).run({
              ...changed,
              id: row.id,
            })
            report.masked++
            reindex?.({ ...row, ...changed })
          }
        }
        maskColumns('episodes', ['text', 'signals'])
        maskColumns(
          'encounters',
          ['seen', 'big_picture', 'evidence', 'key_terms', 'open_questions', 'topic_path'],
          (r) =>
            index.put('encounter', Number(r.seq), [
              String(r.seen ?? ''),
              String(r.big_picture ?? ''),
              listOf(r.topic_path).join(' '),
            ]),
        )
        maskColumns('notes', ['text', 'keywords'], (r) => {
          const status = db.prepare('SELECT status FROM notes WHERE id = ?').pluck().get(r.id)
          if (status === 'active') index.put('note', Number(r.seq), [String(r.text ?? '')])
        })
        maskColumns('concepts', ['name', 'summary'], (r) =>
          index.put('concept', Number(r.seq), [String(r.name ?? ''), String(r.summary ?? '')]),
        )
        maskColumns('chat_messages', ['content'])
      })()
      return report
    },
  }
}
