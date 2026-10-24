/**
 * Row-level helpers for the `concepts` table: the codec, `findConceptSeq` (the oldest concept of a
 * subject with a given conceptKey) and `foldConcept`, which merges one concept row into another
 * and re-points everything that referenced it: child concepts, encounters, notes, prerequisite
 * edges, quiz questions, review actions in chat messages and nudges, the search index (see
 * concept-fold.ts).
 */
import type { CoachAction, Concept, Id } from '@shared/domain'
import { codec, normalizeName, type Params, type Row } from '../codec'
import { foldConcepts, relinkAction, survivorParent } from '../concept-fold'
import { conceptKey } from '../concept-key'
import { must, type StoreCtx } from '../context'
import { reaches } from './notes'

const baseCodec = codec<Omit<Concept, 'summaryPinned'>>({
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

/**
 * The concept codec. `summaryPinned` lives in the `summary_pinned` column (schema v2) and is only
 * present on a decoded concept when true, exactly like the in-memory twin.
 */
export const conceptCodec = {
  ...baseCodec,
  decode(row: Row): Concept {
    const c: Concept = baseCodec.decode(row)
    return row.summary_pinned === 1 || row.summary_pinned === true
      ? { ...c, summaryPinned: true }
      : c
  },
  patchParams(patch: Partial<Concept>): Params {
    const { summaryPinned, ...rest } = patch
    const params = baseCodec.patchParams(rest)
    if (summaryPinned !== undefined) params.summary_pinned = summaryPinned ? 1 : 0
    return params
  },
}

/** Row seq of the oldest concept in `subjectId` whose name has this conceptKey, or null. */
export function findConceptSeq(ctx: StoreCtx, subjectId: Id, key: string): number | null {
  const rows = ctx
    .stmt('SELECT seq, name FROM concepts WHERE subject_id = ? ORDER BY seq')
    .all(subjectId) as { seq: number; name: string }[]
  return rows.find((r) => conceptKey(r.name) === key)?.seq ?? null
}

function conceptRow(ctx: StoreCtx, id: Id): { concept: Concept; seq: number } {
  const row = must(
    ctx.stmt('SELECT * FROM concepts WHERE id = ?').get(id) as Record<string, unknown> | undefined,
    `concept ${id}`,
  )
  return { concept: conceptCodec.decode(row), seq: Number(row.seq) }
}

function relinkActions(ctx: StoreCtx, fromId: Id, intoId: Id): void {
  const { stmt } = ctx
  const messages = stmt('SELECT seq, actions FROM chat_messages WHERE instr(actions, ?) > 0').all(
    fromId,
  ) as { seq: number; actions: string }[]
  for (const m of messages) {
    const actions = JSON.parse(m.actions) as CoachAction[]
    const next = actions.map((a) => relinkAction(a, fromId, intoId) ?? a)
    stmt('UPDATE chat_messages SET actions = ? WHERE seq = ?').run(JSON.stringify(next), m.seq)
  }
  const nudges = stmt(
    'SELECT seq, action FROM nudges WHERE action IS NOT NULL AND instr(action, ?) > 0',
  ).all(fromId) as { seq: number; action: string }[]
  for (const n of nudges) {
    const next = relinkAction(JSON.parse(n.action) as CoachAction, fromId, intoId)
    if (next) stmt('UPDATE nudges SET action = ? WHERE seq = ?').run(JSON.stringify(next), n.seq)
  }
}

/** Re-points `fromId`'s edges at `intoId`, dropping self-loops, duplicates and cycles. */
function moveEdges(ctx: StoreCtx, fromId: Id, intoId: Id): void {
  const { stmt } = ctx
  const moved = stmt(
    'SELECT from_id, to_id, why, source, created_at FROM concept_edges WHERE from_id = ? OR to_id = ?',
  ).all(fromId, fromId) as {
    from_id: string
    to_id: string
    why: string
    source: string
    created_at: string
  }[]
  if (moved.length === 0) return
  stmt('DELETE FROM concept_edges WHERE from_id = ? OR to_id = ?').run(fromId, fromId)
  const subjectId = stmt('SELECT subject_id FROM concepts WHERE id = ?').pluck().get(intoId)
  for (const e of moved) {
    const from = e.from_id === fromId ? intoId : e.from_id
    const to = e.to_id === fromId ? intoId : e.to_id
    if (from === to) continue
    const edges = stmt(
      'SELECT e.from_id AS fromId, e.to_id AS toId FROM concept_edges e JOIN concepts c ON c.id = e.from_id WHERE c.subject_id = ?',
    ).all(subjectId) as { fromId: string; toId: string }[]
    if (edges.some((x) => x.fromId === from && x.toId === to) || reaches(edges, to, from)) continue
    stmt(
      'INSERT INTO concept_edges (from_id, to_id, why, source, created_at) VALUES (?, ?, ?, ?, ?)',
    ).run(from, to, e.why, e.source, e.created_at)
  }
}

/**
 * Folds concept `fromId` into `intoId` and deletes `fromId`. Callers run it inside a transaction;
 * the two may live in different subjects (SubjectRepo.merge folds before re-homing the rest).
 */
export function foldConcept(ctx: StoreCtx, fromId: Id, intoId: Id): Concept {
  if (fromId === intoId) return conceptRow(ctx, intoId).concept
  const { stmt, index } = ctx
  const from = conceptRow(ctx, fromId)
  const into = conceptRow(ctx, intoId)
  const merged: Concept = {
    ...foldConcepts(into.concept, from.concept),
    parentId: survivorParent(into.concept, from.concept),
  }
  stmt('UPDATE concepts SET parent_id = ? WHERE parent_id = ? AND id <> ?').run(
    intoId,
    fromId,
    intoId,
  )
  stmt('UPDATE encounters SET concept_id = ? WHERE concept_id = ?').run(intoId, fromId)
  stmt('UPDATE notes SET concept_id = ?, subject_id = ? WHERE concept_id = ?').run(
    intoId,
    into.concept.subjectId,
    fromId,
  )
  moveEdges(ctx, fromId, intoId)
  stmt('UPDATE questions SET concept_id = ? WHERE concept_id = ?').run(intoId, fromId)
  relinkActions(ctx, fromId, intoId)
  stmt('DELETE FROM concepts WHERE id = ?').run(fromId)
  index.remove('concept', from.seq)
  const { id: _id, subjectId: _s, ...fields } = merged
  const params = { ...conceptCodec.patchParams(fields), name_key: normalizeName(merged.name) }
  const sets = Object.keys(params).map((c) => `${c} = @${c}`)
  stmt(`UPDATE concepts SET ${sets.join(', ')} WHERE id = @id`).run({ ...params, id: intoId })
  index.put('concept', into.seq, [merged.name, merged.summary])
  return merged
}
