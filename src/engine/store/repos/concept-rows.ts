/**
 * Row-level helpers for the `concepts` table: the codec, `findConceptSeq` (the oldest concept of a
 * subject with a given conceptKey) and `foldConcept`, which merges one concept row into another
 * and re-points everything that referenced it: child concepts, encounters, quiz questions, review
 * actions in chat messages and nudges, the search index (see concept-fold.ts).
 */
import type { CoachAction, Concept, Id } from '@shared/domain'
import { codec, normalizeName } from '../codec'
import { foldConcepts, relinkAction, survivorParent } from '../concept-fold'
import { conceptKey } from '../concept-key'
import { must, type StoreCtx } from '../context'

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
