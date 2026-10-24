/**
 * SQLite SearchRepo: FTS5 matches (search-index.ts) turned into SearchHits with the same titles,
 * snippets, routes and ordering as the in-memory twin (subjects, concepts, encounters, exams, then
 * notes shown as their concept or encounter; see note-hit.ts).
 */
import type { SearchHit } from '@shared/state'
import { APP_ROUTES } from '@shared/state'
import type { SearchRepo } from '../../contracts'
import type { Row } from '../codec'
import type { StoreCtx } from '../context'
import { noteSearchHit } from '../note-hit'
import type { SearchKind } from '../search-index'
import { conceptCodec } from './concepts'
import { encounterCodec } from './encounters'
import { noteCodec } from './notes'
import { quizCodec } from './quizzes'
import { subjectCodec } from './subjects'

export function createSearchRepo(ctx: StoreCtx): SearchRepo {
  const { stmt } = ctx
  const bySeq = (table: string, seq: number) =>
    stmt(`SELECT * FROM ${table} WHERE seq = ?`).get(seq) as Row | undefined

  const hitFor = (kind: SearchKind, seq: number): SearchHit | null => {
    switch (kind) {
      case 'subject': {
        const r = bySeq('subjects', seq)
        if (!r) return null
        const s = subjectCodec.decode(r)
        return {
          kind,
          id: s.id,
          title: `${s.emoji} ${s.name}`,
          snippet: s.goal ?? s.description,
          subjectId: s.id,
          route: APP_ROUTES.subject(s.id, 'roadmap'),
        }
      }
      case 'concept': {
        const r = bySeq('concepts', seq)
        if (!r) return null
        const c = conceptCodec.decode(r)
        return {
          kind,
          id: c.id,
          title: c.name,
          snippet: c.summary,
          subjectId: c.subjectId,
          route: APP_ROUTES.subject(c.subjectId, 'concepts'),
        }
      }
      case 'encounter': {
        const r = bySeq('encounters', seq)
        if (!r) return null
        const e = encounterCodec.decode(r)
        if (e.inboxState === 'ignored') return null
        return {
          kind,
          id: e.id,
          title: e.topicPath.at(-1) ?? e.source.title ?? 'Seen',
          snippet: e.seen.slice(0, 140),
          subjectId: e.subjectId,
          route: e.subjectId ? APP_ROUTES.subject(e.subjectId, 'seen') : APP_ROUTES.inbox,
        }
      }
      case 'exam': {
        const r = bySeq('quizzes', seq)
        if (!r) return null
        const q = quizCodec.decode(r)
        if (q.kind !== 'exam') return null
        const count = Number(
          stmt('SELECT COUNT(*) FROM questions WHERE quiz_id = ?').pluck().get(q.id),
        )
        return {
          kind,
          id: q.id,
          title: q.title,
          snippet: `${count} questions`,
          subjectId: q.subjectIds[0] ?? null,
          route: APP_ROUTES.exam(q.id),
        }
      }
      case 'note': {
        const r = bySeq('notes', seq)
        if (!r) return null
        const n = noteCodec.decode(r)
        if (n.status !== 'active') return null
        const c = n.conceptId
          ? (stmt('SELECT * FROM concepts WHERE id = ?').get(n.conceptId) as Row | undefined)
          : undefined
        return noteSearchHit(n, c ? conceptCodec.decode(c) : null)
      }
    }
  }

  return {
    query(q, limit) {
      const hits: SearchHit[] = []
      if (!(limit > 0)) return hits
      for (const ref of ctx.index.match(q)) {
        const hit = hitFor(ref.kind, ref.seq)
        if (!hit || hits.some((h) => h.kind === hit.kind && h.id === hit.id)) continue
        hits.push(hit)
        if (hits.length >= limit) break
      }
      return hits
    },
  }
}
