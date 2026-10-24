/** SQLite ConceptRepo: per-subject concept tree with mastery and review scheduling fields. */
import type { Concept, Id } from '@shared/domain'
import type { ConceptRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, normalizeName, type Row, updateSql } from '../codec'
import { must, type StoreCtx, sqlLimit } from '../context'

export const conceptCodec = codec<Concept>({
  id: 'text',
  subjectId: 'text',
  parentId: 'text',
  name: 'text',
  summary: 'text',
  mastery: 'num',
  box: 'num',
  nextReviewAt: 'text',
  status: 'text',
  struggleCount: 'num',
  lastSeenAt: 'text',
})

const INSERT = insertSql('concepts', [...conceptCodec.columns, 'name_key'])

/** Concept repo plus the one write the contract lacks: moving a concept to another subject. */
export interface SqliteConceptRepo extends ConceptRepo {
  moveToSubject(id: Id, subjectId: Id): Concept
}

export function createConceptRepo(ctx: StoreCtx): SqliteConceptRepo {
  const { stmt, index } = ctx
  const decodeAll = (rows: unknown[]) => (rows as Row[]).map((r) => conceptCodec.decode(r))
  const reindex = (id: string) => {
    const r = must(
      stmt('SELECT * FROM concepts WHERE id = ?').get(id) as Row | undefined,
      `concept ${id}`,
    )
    index.put('concept', Number(r.seq), [String(r.name), String(r.summary)])
  }

  const repo: SqliteConceptRepo = {
    listBySubject: (subjectId) =>
      decodeAll(stmt('SELECT * FROM concepts WHERE subject_id = ? ORDER BY seq').all(subjectId)),

    get(id) {
      const r = stmt('SELECT * FROM concepts WHERE id = ?').get(id) as Row | undefined
      return r ? conceptCodec.decode(r) : null
    },

    findByName(subjectId, name) {
      const r = stmt(
        'SELECT * FROM concepts WHERE subject_id = ? AND name_key = ? ORDER BY seq LIMIT 1',
      ).get(subjectId, normalizeName(name)) as Row | undefined
      return r ? conceptCodec.decode(r) : null
    },

    upsert(input) {
      const existing = repo.findByName(input.subjectId, input.name)
      if (existing) {
        if (input.summary && !existing.summary)
          return repo.update(existing.id, { summary: input.summary })
        return existing
      }
      const parentName = input.parentName?.trim() ? input.parentName : null
      // A concept can't be its own parent; the in-memory twin would create a duplicate here.
      const selfParent =
        parentName !== null && normalizeName(parentName) === normalizeName(input.name)
      const parent =
        parentName && !selfParent
          ? repo.upsert({ subjectId: input.subjectId, name: parentName })
          : null
      const concept: Concept = {
        id: newId('con'),
        subjectId: input.subjectId,
        parentId: parent?.id ?? null,
        name: input.name.trim(),
        summary: input.summary ?? '',
        mastery: 0,
        box: 0,
        nextReviewAt: null,
        status: 'new',
        struggleCount: 0,
        lastSeenAt: null,
      }
      const info = stmt(INSERT).run({
        ...conceptCodec.params(concept),
        name_key: normalizeName(concept.name),
      })
      index.put('concept', Number(info.lastInsertRowid), [concept.name, concept.summary])
      return concept
    },

    update(id, patch) {
      must(repo.get(id), `concept ${id}`)
      const { id: _id, subjectId: _s, ...rest } = patch as Partial<Concept>
      const params = conceptCodec.patchParams(rest)
      if (typeof rest.name === 'string')
        Object.assign(params, { name_key: normalizeName(rest.name) })
      if (Object.keys(params).length > 0) {
        stmt(updateSql('concepts', Object.keys(params), 'id = @id')).run({ ...params, id })
        if ('name' in params || 'summary' in params) reindex(id)
      }
      return must(repo.get(id), `concept ${id}`)
    },

    listDue: (nowIso, limit) =>
      decodeAll(
        stmt(
          'SELECT * FROM concepts WHERE next_review_at IS NOT NULL AND next_review_at <= ? ORDER BY next_review_at ASC, seq ASC LIMIT ?',
        ).all(nowIso, sqlLimit(limit)),
      ),

    listStruggling: (limit) =>
      decodeAll(
        stmt(
          "SELECT * FROM concepts WHERE status = 'struggling' ORDER BY struggle_count DESC, mastery ASC, seq ASC LIMIT ?",
        ).all(sqlLimit(limit)),
      ),

    moveToSubject(id, subjectId) {
      const concept = must(repo.get(id), `concept ${id}`)
      if (concept.subjectId === subjectId) return concept
      const parent = concept.parentId ? repo.get(concept.parentId) : null
      const newParent = parent ? repo.findByName(subjectId, parent.name) : null
      ctx.db.transaction(() => {
        // Children left behind hang from the moved concept's old parent.
        stmt('UPDATE concepts SET parent_id = ? WHERE parent_id = ? AND subject_id <> ?').run(
          concept.parentId,
          id,
          subjectId,
        )
        stmt('UPDATE concepts SET subject_id = ?, parent_id = ? WHERE id = ?').run(
          subjectId,
          newParent?.id ?? null,
          id,
        )
      })()
      return must(repo.get(id), `concept ${id}`)
    },
  }
  return repo
}
