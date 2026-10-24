/** SQLite FeedbackRepo: the student's feedback to Dumbledore, newest first. */
import type { Feedback } from '@shared/domain'
import type { FeedbackRepo } from '../../contracts'
import { newId } from '../../ids'
import { codec, insertSql, type Row } from '../codec'
import type { StoreCtx } from '../context'

export const feedbackCodec = codec<Feedback>({
  id: 'text',
  scope: 'text',
  subjectId: 'text',
  text: 'text',
  createdAt: 'text',
})

const INSERT = insertSql('feedback', feedbackCodec.columns)
/** Stored feedback is short: one or two sentences. */
export const FEEDBACK_MAX_CHARS = 300

export function createFeedbackRepo(ctx: StoreCtx): FeedbackRepo {
  const { stmt } = ctx
  return {
    add(input) {
      const text = input.text.trim().slice(0, FEEDBACK_MAX_CHARS)
      if (!text) throw new Error('Feedback needs text')
      const item: Feedback = {
        id: newId('fbk'),
        scope: input.scope,
        subjectId: input.subjectId,
        text,
        createdAt: ctx.now(),
      }
      stmt(INSERT).run(feedbackCodec.params(item))
      return item
    },

    recent({ scopes, limit }) {
      const rows = (
        scopes?.length
          ? stmt(
              `SELECT * FROM feedback WHERE scope IN (${scopes.map(() => '?').join(', ')}) ORDER BY seq DESC LIMIT ?`,
            ).all(...scopes, limit)
          : stmt('SELECT * FROM feedback ORDER BY seq DESC LIMIT ?').all(limit)
      ) as Row[]
      return rows.map((r) => feedbackCodec.decode(r))
    },

    remove(id) {
      stmt('DELETE FROM feedback WHERE id = ?').run(id)
    },
  }
}
