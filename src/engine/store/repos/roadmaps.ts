/**
 * SQLite RoadmapRepo: `roadmaps` + `roadmap_items` (one row per item, in array order). A row with
 * `superseded_at` is an earlier version (schema v5): only `get`, `history` and `version` see it.
 */
import type { Roadmap, RoadmapItem, RoadmapVersion } from '@shared/domain'
import type { RoadmapRepo } from '../../contracts'
import { codec, insertSql, type Row } from '../codec'
import type { StoreCtx } from '../context'

type RoadmapRow = Omit<Roadmap, 'items'>

export const roadmapCodec = codec<RoadmapRow>({
  id: 'text',
  subjectId: 'text',
  title: 'text',
  goal: 'text',
  startReason: 'text',
  offerPlacement: 'bool',
  estimatedMinutes: 'num',
  status: 'text',
  carry: 'json',
  nextMilestone: 'text',
  createdAt: 'text',
  updatedAt: 'text',
})

const UPSERT = `${insertSql('roadmaps', roadmapCodec.columns)}
  ON CONFLICT (id) DO UPDATE SET ${roadmapCodec.columns
    .filter((c) => c !== 'id')
    .map((c) => `${c} = excluded.${c}`)
    .join(', ')}, version = roadmaps.version + 1`

const ITEM_COLUMNS = [
  'roadmap_id',
  'pos',
  'id',
  'idx',
  'kind',
  'title',
  'status',
  'objective',
  'concepts',
  'move',
  'prompt_draft',
  'prompt_sent',
  'covers',
  'probes',
  'n_questions',
  'quiz_id',
  'score',
]
const INSERT_ITEM = insertSql('roadmap_items', ITEM_COLUMNS)

function itemParams(roadmapId: string, pos: number, item: RoadmapItem): Record<string, unknown> {
  const params: Record<string, unknown> = Object.fromEntries(ITEM_COLUMNS.map((c) => [c, null]))
  Object.assign(params, {
    roadmap_id: roadmapId,
    pos,
    id: item.id,
    idx: item.idx,
    kind: item.kind,
    title: item.title,
    status: item.status,
  })
  if (item.kind === 'learn') {
    Object.assign(params, {
      objective: item.objective,
      concepts: JSON.stringify(item.concepts),
      move: item.move,
      prompt_draft: item.promptDraft,
      prompt_sent: item.promptSent,
    })
  } else {
    Object.assign(params, {
      covers: JSON.stringify(item.covers),
      probes: JSON.stringify(item.probes),
      n_questions: item.nQuestions,
      quiz_id: item.quizId,
      score: item.score,
    })
  }
  return params
}

function decodeItem(r: Row): RoadmapItem {
  const base = { id: String(r.id), idx: Number(r.idx), title: String(r.title) }
  const status = r.status as RoadmapItem['status']
  if (r.kind === 'learn') {
    return {
      kind: 'learn',
      ...base,
      objective: String(r.objective ?? ''),
      concepts: JSON.parse(String(r.concepts ?? '[]')) as string[],
      move: r.move as Extract<RoadmapItem, { kind: 'learn' }>['move'],
      promptDraft: String(r.prompt_draft ?? ''),
      promptSent: (r.prompt_sent as string | null) ?? null,
      status,
    }
  }
  return {
    kind: 'checkpoint',
    ...base,
    covers: JSON.parse(String(r.covers ?? '[]')) as string[],
    probes: JSON.parse(String(r.probes ?? '[]')) as Extract<
      RoadmapItem,
      { kind: 'checkpoint' }
    >['probes'],
    nQuestions: Number(r.n_questions ?? 0),
    quizId: (r.quiz_id as string | null) ?? null,
    score: r.score === null || r.score === undefined ? null : Number(r.score),
    status,
  }
}

export function createRoadmapRepo(ctx: StoreCtx): RoadmapRepo {
  const { stmt } = ctx
  const hydrate = (r: Row): Roadmap => ({
    ...roadmapCodec.decode(r),
    items: (
      stmt('SELECT * FROM roadmap_items WHERE roadmap_id = ? ORDER BY pos').all(r.id) as Row[]
    ).map(decodeItem),
  })
  const many = (sql: string, ...params: unknown[]) =>
    (stmt(sql).all(...params) as Row[]).map(hydrate)
  const asVersion = (r: Row): RoadmapVersion => ({
    roadmap: hydrate(r),
    replacedAt: String(r.superseded_at),
    replacedBy: (r.superseded_by as string | null) ?? null,
    reason: String(r.supersede_reason ?? ''),
  })

  return {
    get(id) {
      const r = stmt('SELECT * FROM roadmaps WHERE id = ?').get(id) as Row | undefined
      return r ? hydrate(r) : null
    },
    getActive(subjectId) {
      const r = stmt(
        "SELECT * FROM roadmaps WHERE subject_id = ? AND status <> 'done' AND superseded_at IS NULL ORDER BY updated_at DESC, seq ASC LIMIT 1",
      ).get(subjectId) as Row | undefined
      return r ? hydrate(r) : null
    },
    listBySubject: (subjectId) =>
      many(
        'SELECT * FROM roadmaps WHERE subject_id = ? AND superseded_at IS NULL ORDER BY created_at DESC, seq ASC',
        subjectId,
      ),
    listActive: () =>
      many(
        "SELECT * FROM roadmaps WHERE status = 'active' AND superseded_at IS NULL ORDER BY updated_at DESC, seq ASC",
      ),
    save(roadmap) {
      ctx.db.transaction(() => {
        const { items, ...row } = roadmap
        stmt(UPSERT).run(roadmapCodec.params(row))
        stmt('DELETE FROM roadmap_items WHERE roadmap_id = ?').run(roadmap.id)
        items.forEach((item, pos) => {
          stmt(INSERT_ITEM).run(itemParams(roadmap.id, pos, item))
        })
      })()
    },
    history: (subjectId) =>
      (
        stmt(
          'SELECT * FROM roadmaps WHERE subject_id = ? AND superseded_at IS NOT NULL ORDER BY superseded_at DESC, seq DESC',
        ).all(subjectId) as Row[]
      ).map(asVersion),
    version(id) {
      const r = stmt('SELECT * FROM roadmaps WHERE id = ? AND superseded_at IS NOT NULL').get(id) as
        | Row
        | undefined
      return r ? asVersion(r) : null
    },
    supersede(id, info) {
      stmt(
        'UPDATE roadmaps SET superseded_at = ?, superseded_by = ?, supersede_reason = ? WHERE id = ?',
      ).run(info.at, info.by, info.reason, id)
    },
    unsupersede(id) {
      stmt(
        'UPDATE roadmaps SET superseded_at = NULL, superseded_by = NULL, supersede_reason = NULL WHERE id = ?',
      ).run(id)
    },
  }
}
