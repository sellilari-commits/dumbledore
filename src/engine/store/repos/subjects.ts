/** SQLite SubjectRepo, including merge (moves everything a subject owns into another). */
import type { Subject } from '@shared/domain'
import type { SubjectRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, normalizeName, type Row, updateSql } from '../codec'
import { must, type StoreCtx } from '../context'

export const subjectCodec = codec<Subject>({
  id: 'text',
  name: 'text',
  emoji: 'text',
  color: 'text',
  description: 'text',
  goal: 'text',
  deadline: 'text',
  status: 'text',
  focus: 'text',
  createdAt: 'text',
  updatedAt: 'text',
})

const INSERT = insertSql('subjects', [...subjectCodec.columns, 'name_key'])

export function createSubjectRepo(ctx: StoreCtx): SubjectRepo {
  const { stmt, index } = ctx
  const row = (id: string) => stmt('SELECT * FROM subjects WHERE id = ?').get(id) as Row | undefined
  const reindex = (id: string) => {
    const r = must(row(id), `subject ${id}`)
    const s = subjectCodec.decode(r)
    index.put('subject', Number(r.seq), [s.name, s.description, s.goal])
  }

  const repo: SubjectRepo = {
    list(filter) {
      const rows = stmt('SELECT * FROM subjects ORDER BY created_at ASC, seq ASC').all() as Row[]
      return rows
        .map((r) => subjectCodec.decode(r))
        .filter((s) => !filter?.status || filter.status.includes(s.status))
    },

    get(id) {
      const r = row(id)
      return r ? subjectCodec.decode(r) : null
    },

    findByName(name) {
      const r = stmt('SELECT * FROM subjects WHERE name_key = ? ORDER BY seq LIMIT 1').get(
        normalizeName(name),
      ) as Row | undefined
      return r ? subjectCodec.decode(r) : null
    },

    create(input) {
      const t = ctx.now()
      const subject: Subject = {
        id: newId('sub'),
        name: input.name.trim(),
        emoji: input.emoji ?? '📘',
        color: input.color ?? 'default',
        description: input.description ?? '',
        goal: input.goal ?? null,
        deadline: input.deadline ?? null,
        status: input.status ?? 'active',
        focus: 'normal',
        createdAt: t,
        updatedAt: t,
      }
      const info = stmt(INSERT).run({
        ...subjectCodec.params(subject),
        name_key: normalizeName(subject.name),
      })
      index.put('subject', Number(info.lastInsertRowid), [
        subject.name,
        subject.description,
        subject.goal,
      ])
      return subject
    },

    update(id, patch) {
      must(row(id), `subject ${id}`)
      const { id: _id, createdAt: _c, updatedAt: _u, ...rest } = patch as Partial<Subject>
      const params = { ...subjectCodec.patchParams(rest), updated_at: ctx.now() }
      if (typeof rest.name === 'string')
        Object.assign(params, { name_key: normalizeName(rest.name) })
      stmt(updateSql('subjects', Object.keys(params), 'id = @id')).run({ ...params, id })
      reindex(id)
      return must(repo.get(id), `subject ${id}`)
    },

    merge(fromId, intoId) {
      must(row(fromId), `subject ${fromId}`)
      must(row(intoId), `subject ${intoId}`)
      if (fromId === intoId) throw new Error(`cannot merge subject ${fromId} into itself`)
      ctx.db.transaction(() => mergeSubjects(ctx, fromId, intoId))()
    },
  }
  return repo
}

function mergeSubjects(ctx: StoreCtx, fromId: string, intoId: string): void {
  const { stmt, index } = ctx
  const moving = stmt(
    'SELECT seq, id, name_key FROM concepts WHERE subject_id = ? ORDER BY seq',
  ).all(fromId) as { seq: number; id: string; name_key: string }[]
  const twins: { seq: number; id: string; twinId: string }[] = []
  for (const c of moving) {
    const twinId = stmt(
      'SELECT id FROM concepts WHERE subject_id = ? AND name_key = ? ORDER BY seq LIMIT 1',
    )
      .pluck()
      .get(intoId, c.name_key) as string | undefined
    if (twinId) twins.push({ seq: c.seq, id: c.id, twinId })
    else stmt('UPDATE concepts SET subject_id = ? WHERE id = ?').run(intoId, c.id)
  }
  for (const t of twins) {
    stmt('UPDATE concepts SET parent_id = ? WHERE parent_id = ?').run(t.twinId, t.id)
    stmt('UPDATE encounters SET concept_id = ? WHERE concept_id = ?').run(t.twinId, t.id)
    stmt('UPDATE questions SET concept_id = ? WHERE concept_id = ?').run(t.twinId, t.id)
    stmt('DELETE FROM concepts WHERE id = ?').run(t.id)
    index.remove('concept', t.seq)
  }
  stmt('UPDATE encounters SET subject_id = ? WHERE subject_id = ?').run(intoId, fromId)
  stmt('UPDATE roadmaps SET subject_id = ? WHERE subject_id = ?').run(intoId, fromId)
  stmt('UPDATE assignments SET subject_id = ? WHERE subject_id = ?').run(intoId, fromId)
  const quizzes = stmt(
    'SELECT q.id, q.subject_ids FROM quizzes q WHERE EXISTS (SELECT 1 FROM json_each(q.subject_ids) j WHERE j.value = ?)',
  ).all(fromId) as { id: string; subject_ids: string }[]
  for (const q of quizzes) {
    const ids = (JSON.parse(q.subject_ids) as string[]).map((s) => (s === fromId ? intoId : s))
    stmt('UPDATE quizzes SET subject_ids = ? WHERE id = ?').run(
      JSON.stringify([...new Set(ids)]),
      q.id,
    )
  }
  const fromSeq = stmt('SELECT seq FROM subjects WHERE id = ?').pluck().get(fromId) as number
  stmt('DELETE FROM subjects WHERE id = ?').run(fromId)
  index.remove('subject', Number(fromSeq))
}
