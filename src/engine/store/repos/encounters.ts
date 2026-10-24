/** SQLite EncounterRepo (extracted learning records) and EpisodeRepo (raw reading stretches). */
import type { Encounter, Episode, Id } from '@shared/domain'
import type { EncounterRepo, EpisodeRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, normalizeName, type Row } from '../codec'
import { must, type StoreCtx, sqlLimit } from '../context'

export const encounterCodec = codec<Encounter>({
  id: 'text',
  subjectId: 'text',
  conceptId: 'text',
  episodeId: 'text',
  seen: 'text',
  bigPicture: 'text',
  topicPath: 'json',
  understanding: 'text',
  evidence: 'text',
  openQuestions: 'json',
  keyTerms: 'json',
  source: 'json',
  dwellSeconds: 'num',
  inboxState: 'text',
  createdAt: 'text',
})

export const episodeCodec = codec<Episode>({
  id: 'text',
  bundleId: 'text',
  app: 'text',
  title: 'text',
  url: 'text',
  kind: 'text',
  aiProvider: 'text',
  startedAt: 'text',
  endedAt: 'text',
  dwellSeconds: 'num',
  text: 'text',
  source: 'text',
  signals: 'json',
  extracted: 'bool',
})

/** Encounter repo plus the write the contract lacks: re-pointing an encounter's concept. */
export interface SqliteEncounterRepo extends EncounterRepo {
  setConcept(id: Id, conceptId: Id | null): Encounter
}

export function createEncounterRepo(ctx: StoreCtx): SqliteEncounterRepo {
  const { stmt, index } = ctx
  const getRow = (id: string) =>
    stmt('SELECT * FROM encounters WHERE id = ?').get(id) as Row | undefined
  const get = (id: string) => encounterCodec.decode(must(getRow(id), `encounter ${id}`))

  const repo: SqliteEncounterRepo = {
    add(input) {
      const encounter: Encounter = {
        ...structuredClone(input),
        id: newId('enc'),
        inboxState: input.inboxState ?? 'new',
        createdAt: ctx.now(),
      }
      const info = stmt(insertSql('encounters', encounterCodec.columns)).run(
        encounterCodec.params(encounter),
      )
      index.put('encounter', Number(info.lastInsertRowid), [
        encounter.seen,
        encounter.bigPicture,
        encounter.topicPath.join(' '),
      ])
      return encounter
    },

    list(filter) {
      const where: string[] = []
      const params: Record<string, unknown> = { limit: sqlLimit(filter.limit) }
      if (filter.subjectId != null) {
        where.push('subject_id = @subjectId')
        params.subjectId = filter.subjectId
      }
      if (filter.inboxState != null) {
        where.push('inbox_state = @inboxState')
        params.inboxState = filter.inboxState
      }
      if (filter.sinceIso) {
        where.push('created_at >= @sinceIso')
        params.sinceIso = filter.sinceIso
      }
      const sql = `SELECT * FROM encounters ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY created_at DESC, id DESC LIMIT @limit`
      return (stmt(sql).all(params) as Row[]).map((r) => encounterCodec.decode(r))
    },

    setInboxState(id, state, subjectId) {
      get(id)
      if (subjectId === undefined)
        stmt('UPDATE encounters SET inbox_state = ? WHERE id = ?').run(state, id)
      else
        stmt('UPDATE encounters SET inbox_state = ?, subject_id = ? WHERE id = ?').run(
          state,
          subjectId,
          id,
        )
      return get(id)
    },

    openQuestions(subjectId, limit) {
      const out: string[] = []
      if (limit <= 0) return out
      const seen = new Set<string>()
      for (const e of repo.list({ subjectId })) {
        if (e.inboxState === 'ignored') continue
        for (const q of e.openQuestions) {
          const key = normalizeName(q)
          if (seen.has(key)) continue
          seen.add(key)
          out.push(q)
          if (out.length >= limit) return out
        }
      }
      return out
    },

    setConcept(id, conceptId) {
      get(id)
      stmt('UPDATE encounters SET concept_id = ? WHERE id = ?').run(conceptId, id)
      return get(id)
    },
  }
  return repo
}

const EPISODE_UPSERT = `${insertSql('episodes', episodeCodec.columns)}
  ON CONFLICT (id) DO UPDATE SET ${episodeCodec.columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}`

export function createEpisodeRepo(ctx: StoreCtx): EpisodeRepo {
  const { stmt } = ctx
  const decodeAll = (rows: unknown[]) => (rows as Row[]).map((r) => episodeCodec.decode(r))
  return {
    save: (episode) => void stmt(EPISODE_UPSERT).run(episodeCodec.params(episode)),
    get(id) {
      const r = stmt('SELECT * FROM episodes WHERE id = ?').get(id) as Row | undefined
      return r ? episodeCodec.decode(r) : null
    },
    listUnextracted: (limit) =>
      decodeAll(
        stmt(
          'SELECT * FROM episodes WHERE extracted = 0 ORDER BY ended_at ASC, seq ASC LIMIT ?',
        ).all(sqlLimit(limit)),
      ),
    markExtracted(id) {
      const info = stmt('UPDATE episodes SET extracted = 1 WHERE id = ?').run(id)
      if (info.changes === 0) throw new Error(`episode ${id} not found`)
    },
    recent: (filter) =>
      decodeAll(
        stmt(
          'SELECT * FROM episodes WHERE ended_at >= ? ORDER BY ended_at DESC, seq ASC LIMIT ?',
        ).all(filter.sinceIso, sqlLimit(filter.limit)),
      ),
    purgeTextOlderThan: (iso) =>
      stmt("UPDATE episodes SET text = '' WHERE ended_at < ? AND text <> ''").run(iso).changes,
  }
}
