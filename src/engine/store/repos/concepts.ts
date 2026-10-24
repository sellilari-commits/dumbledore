/**
 * SQLite ConceptRepo: per-subject concept tree with mastery and review scheduling fields.
 * Names match by conceptKey() (case, spacing, punctuation and simple plurals ignored), computed
 * here rather than stored: `name_key` keeps normalizeName(), which older app builds look up.
 */
import type { Concept, Id } from '@shared/domain'
import type { ConceptRepo } from '../../contracts'
import { newId } from '../../ids'
import { insertSql, normalizeName, type Row, updateSql } from '../codec'
import { conceptKey, isNicerName } from '../concept-key'
import { must, type StoreCtx, sqlLimit } from '../context'
import { conceptCodec, findConceptSeq, foldConcept } from './concept-rows'

export { conceptCodec } from './concept-rows'

const INSERT = insertSql('concepts', [...conceptCodec.columns, 'name_key'])

/** Concept repo plus writes the contract lacks: moving a concept, folding two into one. */
export interface SqliteConceptRepo extends ConceptRepo {
  moveToSubject(id: Id, subjectId: Id): Concept
  /** Folds `fromId` into `intoId` (same subject) and deletes `fromId`; see concept-fold.ts. */
  mergeInto(fromId: Id, intoId: Id): Concept
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
      const seq = findConceptSeq(ctx, subjectId, conceptKey(name))
      if (seq === null) return null
      const r = stmt('SELECT * FROM concepts WHERE seq = ?').get(seq) as Row
      return conceptCodec.decode(r)
    },

    upsert(input) {
      const existing = repo.findByName(input.subjectId, input.name)
      if (existing) {
        const patch: { name?: string; summary?: string } = {}
        if (isNicerName(existing.name, input.name)) patch.name = input.name.trim()
        if (input.summary && !existing.summary) patch.summary = input.summary
        return Object.keys(patch).length > 0 ? repo.update(existing.id, patch) : existing
      }
      const parentName = input.parentName?.trim() ? input.parentName : null
      // A concept can't be its own parent.
      const selfParent = parentName !== null && conceptKey(parentName) === conceptKey(input.name)
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

    mergeInto(fromId, intoId) {
      const from = must(repo.get(fromId), `concept ${fromId}`)
      const into = must(repo.get(intoId), `concept ${intoId}`)
      if (from.subjectId !== into.subjectId)
        throw new Error(`concepts ${fromId} and ${intoId} belong to different subjects`)
      return ctx.db.transaction(() => foldConcept(ctx, fromId, intoId))()
    },
  }
  return repo
}
