/**
 * SQLite NoteRepo and EdgeRepo (docs/NOTES.md §3, §6). Notes dedupe on write within their place
 * (concept, else subject without concept, else the loose notes) by note-key.ts; deletes are
 * soft (status 'deleted') and take the note out of search. Edges refuse self-loops, concepts of
 * different subjects, duplicates and cycles.
 */
import type { ConceptEdge, Note } from '@shared/domain'
import type { EdgeRepo, NoteRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, type Row, updateSql } from '../codec'
import { must, type StoreCtx, sqlLimit } from '../context'
import { cleanKeywords, clipNote, noteKey, sameNote } from '../note-key'

export const noteCodec = codec<Note>({
  id: 'text',
  subjectId: 'text',
  conceptId: 'text',
  encounterId: 'text',
  kind: 'text',
  text: 'text',
  keywords: 'json',
  source: 'json',
  status: 'text',
  mergedInto: 'text',
  pinned: 'bool',
  createdAt: 'text',
  updatedAt: 'text',
})

export const edgeCodec = codec<ConceptEdge>({
  fromId: 'text',
  toId: 'text',
  why: 'text',
  source: 'text',
  createdAt: 'text',
})

const INSERT = insertSql('notes', [...noteCodec.columns, 'note_key'])

export function createNoteRepo(ctx: StoreCtx): NoteRepo {
  const { stmt, index } = ctx
  const row = (id: string) => stmt('SELECT * FROM notes WHERE id = ?').get(id) as Row | undefined
  const reindex = (id: string) => {
    const r = must(row(id), `note ${id}`)
    const note = noteCodec.decode(r)
    if (note.status === 'active') index.put('note', Number(r.seq), [note.text])
    else index.remove('note', Number(r.seq))
  }

  /** Active notes in the same place as a new note would go. */
  const siblings = (subjectId: string | null, conceptId: string | null): Note[] => {
    const rows = conceptId
      ? stmt("SELECT * FROM notes WHERE concept_id = ? AND status = 'active' ORDER BY seq").all(
          conceptId,
        )
      : subjectId
        ? stmt(
            "SELECT * FROM notes WHERE subject_id = ? AND concept_id IS NULL AND status = 'active' ORDER BY seq",
          ).all(subjectId)
        : stmt(
            "SELECT * FROM notes WHERE subject_id IS NULL AND concept_id IS NULL AND status = 'active' ORDER BY seq",
          ).all()
    return (rows as Row[]).map((r) => noteCodec.decode(r))
  }

  const repo: NoteRepo = {
    add(input) {
      const text = clipNote(input.text)
      if (!text) throw new Error('A note needs text')
      const twin = siblings(input.subjectId, input.conceptId).find((n) => sameNote(n.text, text))
      if (twin) {
        stmt('UPDATE notes SET keywords = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify(cleanKeywords(twin.keywords, input.keywords)),
          ctx.now(),
          twin.id,
        )
        return { note: must(repo.get(twin.id), `note ${twin.id}`), created: false }
      }
      const t = ctx.now()
      const note: Note = {
        id: newId('not'),
        subjectId: input.subjectId,
        conceptId: input.conceptId,
        encounterId: input.encounterId,
        kind: input.kind,
        text,
        keywords: cleanKeywords(input.keywords),
        source: input.source,
        status: 'active',
        mergedInto: null,
        pinned: false,
        createdAt: t,
        updatedAt: t,
      }
      const info = stmt(INSERT).run({ ...noteCodec.params(note), note_key: noteKey(text) })
      index.put('note', Number(info.lastInsertRowid), [note.text])
      return { note, created: true }
    },

    get(id) {
      const r = row(id)
      return r ? noteCodec.decode(r) : null
    },

    list(filter) {
      const where: string[] = []
      const params: Record<string, unknown> = { limit: sqlLimit(filter.limit) }
      if (filter.subjectId === null) where.push('subject_id IS NULL')
      else if (filter.subjectId !== undefined) {
        where.push('subject_id = @subjectId')
        params.subjectId = filter.subjectId
      }
      if (filter.conceptId !== undefined) {
        where.push('concept_id = @conceptId')
        params.conceptId = filter.conceptId
      }
      if (filter.encounterId !== undefined) {
        where.push('encounter_id = @encounterId')
        params.encounterId = filter.encounterId
      }
      const status = filter.status === undefined ? 'active' : filter.status
      if (status !== null) {
        where.push('status = @status')
        params.status = status
      }
      const sql = `SELECT * FROM notes ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY seq ASC LIMIT @limit`
      return (stmt(sql).all(params) as Row[]).map((r) => noteCodec.decode(r))
    },

    update(id, patch) {
      must(row(id), `note ${id}`)
      const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = patch as Partial<Note>
      if (typeof rest.text === 'string') {
        rest.text = clipNote(rest.text)
        if (!rest.text) throw new Error('A note needs text')
      }
      if (rest.keywords) rest.keywords = cleanKeywords(rest.keywords)
      const params = { ...noteCodec.patchParams(rest), updated_at: ctx.now() }
      if (typeof rest.text === 'string') Object.assign(params, { note_key: noteKey(rest.text) })
      stmt(updateSql('notes', Object.keys(params), 'id = @id')).run({ ...params, id })
      reindex(id)
      return must(repo.get(id), `note ${id}`)
    },

    remove(id) {
      repo.update(id, { status: 'deleted' })
    },

    merge(fromId, intoId, text) {
      must(row(fromId), `note ${fromId}`)
      must(row(intoId), `note ${intoId}`)
      if (fromId === intoId) return must(repo.get(intoId), `note ${intoId}`)
      return ctx.db.transaction(() => {
        repo.update(fromId, { status: 'merged', mergedInto: intoId })
        return text?.trim() ? repo.update(intoId, { text }) : must(repo.get(intoId), 'note')
      })()
    },
  }
  return repo
}

export function createEdgeRepo(ctx: StoreCtx): EdgeRepo {
  const { stmt } = ctx
  const subjectOf = (conceptId: string) =>
    stmt('SELECT subject_id FROM concepts WHERE id = ?').pluck().get(conceptId) as
      | string
      | undefined
  const listAll = (subjectId: string): ConceptEdge[] =>
    (
      stmt(
        `SELECT e.* FROM concept_edges e JOIN concepts c ON c.id = e.from_id
         WHERE c.subject_id = ? ORDER BY e.rowid`,
      ).all(subjectId) as Row[]
    ).map((r) => edgeCodec.decode(r))

  return {
    list: listAll,

    add(input) {
      const { fromId, toId } = input
      if (fromId === toId) return null
      const subjectId = must(subjectOf(fromId), `concept ${fromId}`)
      if (must(subjectOf(toId), `concept ${toId}`) !== subjectId) return null
      const edges = listAll(subjectId)
      if (edges.some((e) => e.fromId === fromId && e.toId === toId)) return null
      if (reaches(edges, toId, fromId)) return null
      const edge: ConceptEdge = {
        fromId,
        toId,
        why: input.why?.trim() ?? '',
        source: input.source ?? 'llm',
        createdAt: ctx.now(),
      }
      stmt(insertSql('concept_edges', edgeCodec.columns)).run(edgeCodec.params(edge))
      return edge
    },

    remove(fromId, toId) {
      stmt('DELETE FROM concept_edges WHERE from_id = ? AND to_id = ?').run(fromId, toId)
    },
  }
}

/** Is `target` reachable from `start` along the edges? (Adding target → start would close a cycle.) */
export function reaches(
  edges: readonly Pick<ConceptEdge, 'fromId' | 'toId'>[],
  start: string,
  target: string,
): boolean {
  const next = new Map<string, string[]>()
  for (const e of edges) next.set(e.fromId, [...(next.get(e.fromId) ?? []), e.toId])
  const seen = new Set<string>()
  const stack = [start]
  while (stack.length) {
    const id = stack.pop() as string
    if (id === target) return true
    if (seen.has(id)) continue
    seen.add(id)
    stack.push(...(next.get(id) ?? []))
  }
  return false
}
