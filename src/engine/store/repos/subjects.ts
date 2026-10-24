/**
 * SQLite SubjectRepo, including merge: moves everything a subject owns into another, folding each
 * concept that the target already has (same conceptKey) into the target's concept.
 */
import type { Subject } from '@shared/domain'
import type { SubjectRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, normalizeName, type Row, updateSql } from '../codec'
import { conceptKey } from '../concept-key'
import { must, type StoreCtx } from '../context'
import { foldConcept } from './concept-rows'

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
      if (fromId === intoId) return
      ctx.db.transaction(() => mergeSubjects(ctx, fromId, intoId))()
    },

    remove(id) {
      must(row(id), `subject ${id}`)
      ctx.db.transaction(() => removeSubject(ctx, id))()
    },
  }
  return repo
}

function mergeSubjects(ctx: StoreCtx, fromId: string, intoId: string): void {
  const { stmt, index } = ctx
  const list = (subjectId: string) =>
    stmt('SELECT id, name FROM concepts WHERE subject_id = ? ORDER BY seq').all(subjectId) as {
      id: string
      name: string
    }[]
  const twins = new Map<string, string>() // conceptKey → oldest concept of the target
  for (const c of list(intoId))
    if (!twins.has(conceptKey(c.name))) twins.set(conceptKey(c.name), c.id)
  const folds: { id: string; twinId: string }[] = []
  for (const c of list(fromId)) {
    const key = conceptKey(c.name)
    const twinId = twins.get(key)
    if (twinId) folds.push({ id: c.id, twinId })
    else {
      stmt('UPDATE concepts SET subject_id = ? WHERE id = ?').run(intoId, c.id)
      twins.set(key, c.id)
    }
  }
  for (const f of folds) foldConcept(ctx, f.id, f.twinId)
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

function removeSubject(ctx: StoreCtx, id: string): void {
  const { stmt, index } = ctx
  const encounters = stmt('SELECT seq, episode_id FROM encounters WHERE subject_id = ?').all(
    id,
  ) as {
    seq: number
    episode_id: string | null
  }[]
  for (const e of encounters) index.remove('encounter', Number(e.seq))
  stmt('DELETE FROM encounters WHERE subject_id = ?').run(id)
  // The raw screen text behind them, unless another subject's encounter still uses it.
  for (const e of encounters) {
    if (!e.episode_id) continue
    stmt(
      'DELETE FROM episodes WHERE id = ? AND NOT EXISTS (SELECT 1 FROM encounters WHERE episode_id = ?)',
    ).run(e.episode_id, e.episode_id)
  }
  const conceptSeqs = stmt('SELECT seq FROM concepts WHERE subject_id = ?')
    .pluck()
    .all(id) as number[]
  for (const seq of conceptSeqs) index.remove('concept', Number(seq))
  stmt('DELETE FROM assignments WHERE subject_id = ?').run(id)
  const quizzes = stmt(
    'SELECT q.seq, q.id, q.kind, q.subject_ids FROM quizzes q WHERE EXISTS (SELECT 1 FROM json_each(q.subject_ids) j WHERE j.value = ?)',
  ).all(id) as { seq: number; id: string; kind: string; subject_ids: string }[]
  for (const q of quizzes) {
    const rest = (JSON.parse(q.subject_ids) as string[]).filter((s) => s !== id)
    if (rest.length > 0) {
      stmt('UPDATE quizzes SET subject_ids = ? WHERE id = ?').run(JSON.stringify(rest), q.id)
      continue
    }
    if (q.kind === 'exam') index.remove('exam', Number(q.seq))
    stmt('DELETE FROM quizzes WHERE id = ?').run(q.id)
  }
  stmt('DELETE FROM chat_messages WHERE thread = ?').run(`subject:${id}`)
  stmt('DELETE FROM nudges WHERE action LIKE ?').run(`%"${id}"%`)
  const seq = stmt('SELECT seq FROM subjects WHERE id = ?').pluck().get(id) as number
  stmt('DELETE FROM subjects WHERE id = ?').run(id) // concepts and roadmaps cascade
  index.remove('subject', Number(seq))
}
