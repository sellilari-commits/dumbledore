/** SQLite RoadmapRepo: `roadmaps` + `roadmap_items` (one row per item, in array order). */
import type { Roadmap, RoadmapItem } from '@shared/domain'
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

  return {
    get(id) {
      const r = stmt('SELECT * FROM roadmaps WHERE id = ?').get(id) as Row | undefined
      return r ? hydrate(r) : null
    },
    getActive(subjectId) {
      const r = stmt(
        "SELECT * FROM roadmaps WHERE subject_id = ? AND status <> 'done' ORDER BY updated_at DESC, seq ASC LIMIT 1",
      ).get(subjectId) as Row | undefined
      return r ? hydrate(r) : null
    },
    listBySubject: (subjectId) =>
      many(
        'SELECT * FROM roadmaps WHERE subject_id = ? ORDER BY created_at DESC, seq ASC',
        subjectId,
      ),
    listActive: () =>
      many("SELECT * FROM roadmaps WHERE status = 'active' ORDER BY updated_at DESC, seq ASC"),
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
  }
}
