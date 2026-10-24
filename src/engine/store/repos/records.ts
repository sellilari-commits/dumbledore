/** SQLite AssignmentRepo, NudgeRepo and ChatRepo. */
import type { Assignment, ChatMessage, Nudge } from '@shared/domain'
import type { AssignmentRepo, ChatRepo, NudgeRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, normalizeName, type Row, updateSql } from '../codec'
import { must, type StoreCtx, sqlLimit } from '../context'

export const assignmentCodec = codec<Assignment>({
  id: 'text',
  subjectId: 'text',
  title: 'text',
  course: 'text',
  dueAt: 'text',
  source: 'text',
  status: 'text',
  createdAt: 'text',
})

const nudgeCodec = codec<Nudge>({
  id: 'text',
  kind: 'text',
  title: 'text',
  body: 'text',
  action: 'json',
  dedupeKey: 'text',
  createdAt: 'text',
  shownAt: 'text',
  outcome: 'text',
})

const chatCodec = codec<ChatMessage>({
  id: 'text',
  thread: 'text',
  role: 'text',
  content: 'text',
  actions: 'json',
  createdAt: 'text',
})

export function createAssignmentRepo(ctx: StoreCtx): AssignmentRepo {
  const { stmt } = ctx
  const get = (id: string) => {
    const r = stmt('SELECT * FROM assignments WHERE id = ?').get(id) as Row | undefined
    return assignmentCodec.decode(must(r, `assignment ${id}`))
  }
  return {
    upsert(input) {
      const twin = stmt(
        "SELECT * FROM assignments WHERE title_key = ? AND COALESCE(due_at, '') = ? ORDER BY seq LIMIT 1",
      ).get(normalizeName(input.title), input.dueAt ?? '') as Row | undefined
      if (twin) return assignmentCodec.decode(twin)
      const assignment: Assignment = {
        id: newId('asg'),
        subjectId: input.subjectId,
        title: input.title.trim(),
        course: input.course ?? null,
        dueAt: input.dueAt,
        source: input.source,
        status: 'open',
        createdAt: ctx.now(),
      }
      stmt(insertSql('assignments', [...assignmentCodec.columns, 'title_key'])).run({
        ...assignmentCodec.params(assignment),
        title_key: normalizeName(assignment.title),
      })
      return assignment
    },
    list(filter) {
      const where: string[] = []
      const params: Record<string, unknown> = { limit: sqlLimit(filter.limit) }
      if (filter.status) {
        where.push('status = @status')
        params.status = filter.status
      }
      if (filter.subjectId) {
        where.push('subject_id = @subjectId')
        params.subjectId = filter.subjectId
      }
      const sql = `SELECT * FROM assignments ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY COALESCE(due_at, '9999') ASC, seq ASC LIMIT @limit`
      return (stmt(sql).all(params) as Row[]).map((r) => assignmentCodec.decode(r))
    },
    update(id, patch) {
      get(id)
      const { id: _id, ...rest } = patch as Partial<Assignment>
      const params = assignmentCodec.patchParams(rest)
      if (typeof rest.title === 'string')
        Object.assign(params, { title_key: normalizeName(rest.title) })
      if (Object.keys(params).length > 0) {
        stmt(updateSql('assignments', Object.keys(params), 'id = @id')).run({ ...params, id })
      }
      return get(id)
    },
  }
}

export function createNudgeRepo(ctx: StoreCtx): NudgeRepo {
  const { stmt } = ctx
  const get = (id: string) => {
    const r = stmt('SELECT * FROM nudges WHERE id = ?').get(id) as Row | undefined
    return nudgeCodec.decode(must(r, `nudge ${id}`))
  }
  return {
    add(input) {
      const nudge: Nudge = {
        ...structuredClone(input),
        id: newId('ndg'),
        createdAt: ctx.now(),
        shownAt: null,
        outcome: 'pending',
      }
      stmt(insertSql('nudges', nudgeCodec.columns)).run(nudgeCodec.params(nudge))
      return nudge
    },
    update(id, patch) {
      get(id)
      const { id: _id, ...rest } = patch as Partial<Nudge>
      const params = nudgeCodec.patchParams(rest)
      if (Object.keys(params).length > 0) {
        stmt(updateSql('nudges', Object.keys(params), 'id = @id')).run({ ...params, id })
      }
      return get(id)
    },
    listSince: (iso) =>
      (
        stmt('SELECT * FROM nudges WHERE created_at >= ? ORDER BY created_at ASC, seq ASC').all(
          iso,
        ) as Row[]
      ).map((r) => nudgeCodec.decode(r)),
    findByDedupeKey(key, sinceIso) {
      const r = stmt(
        'SELECT * FROM nudges WHERE dedupe_key = ? AND created_at >= ? ORDER BY seq LIMIT 1',
      ).get(key, sinceIso) as Row | undefined
      return r ? nudgeCodec.decode(r) : null
    },
  }
}

export function createChatRepo(ctx: StoreCtx): ChatRepo {
  const { stmt } = ctx
  return {
    append(input) {
      const message: ChatMessage = {
        ...structuredClone(input),
        id: newId('msg'),
        createdAt: ctx.now(),
      }
      stmt(insertSql('chat_messages', chatCodec.columns)).run(chatCodec.params(message))
      return message
    },
    history(thread, limit) {
      const rows = stmt(
        'SELECT * FROM (SELECT * FROM chat_messages WHERE thread = ? ORDER BY seq DESC LIMIT ?) ORDER BY seq ASC',
      ).all(thread, sqlLimit(limit)) as Row[]
      return rows.map((r) => chatCodec.decode(r))
    },
  }
}
