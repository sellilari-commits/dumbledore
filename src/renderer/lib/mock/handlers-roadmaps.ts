/**
 * Mock roadmap history: a subject's earlier roadmap versions (replaced, never deleted) and
 * bringing one back, which moves the current roadmap into the history the same way. Mirrors the
 * engine's roadmap history on the mock database; the history itself lives beside the database
 * (one list per MockDb), seeded with two earlier versions for the demo's Organic Chemistry.
 */
import type { CheckpointItem, LearnItem, Roadmap, RoadmapVersion } from '@shared/domain'
import type { HandlerMap, MockContext } from './context'
import type { MockDb } from './db'
import { roadmapFor } from './derive'
import { DAY, HOUR, isoAgo, nowIso } from './time'

export type RoadmapsChannel = 'roadmaps.history' | 'roadmaps.restore'

const histories = new WeakMap<MockDb, RoadmapVersion[]>()

const prompt = (topic: string, ask: string) =>
  `I'm a second-year chemistry student. ${topic}\n${ask}\nNo greetings or small talk. Short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.`

function learn(
  id: string,
  idx: number,
  title: string,
  objective: string,
  concepts: string[],
  move: LearnItem['move'],
  status: LearnItem['status'],
): LearnItem {
  return {
    kind: 'learn',
    id,
    idx,
    title,
    objective,
    concepts,
    move,
    promptDraft: prompt(`I want to understand ${title.toLowerCase()}.`, '1. Explain it simply.'),
    promptSent: status === 'done' ? 'sent' : null,
    status,
  }
}

function checkpoint(id: string, idx: number, title: string, covers: string[]): CheckpointItem {
  return {
    kind: 'checkpoint',
    id,
    idx,
    title,
    covers,
    probes: [],
    nQuestions: 4,
    quizId: null,
    score: null,
    status: 'todo',
  }
}

/** The demo's two earlier Organic Chemistry roadmaps: replanned, and a new roadmap before that. */
function demoHistory(): RoadmapVersion[] {
  const basics: Roadmap = {
    id: 'rm_orgo_basics',
    subjectId: 'sub_orgo',
    title: 'Substitution basics',
    goal: 'Understand nucleophilic substitution and elimination',
    startReason: 'Nucleophiles are new to you, so we start with who attacks whom.',
    offerPlacement: false,
    estimatedMinutes: 42,
    status: 'active',
    carry: [],
    nextMilestone: 'SN1 vs SN2',
    createdAt: isoAgo(12 * DAY),
    updatedAt: isoAgo(5 * DAY + 3 * HOUR),
    items: [
      learn(
        'ri_hb1',
        0,
        'Nucleophiles & electrophiles',
        'Can point to the nucleophile and electrophile in any substitution.',
        ['Nucleophiles', 'Electrophiles'],
        'definition',
        'done',
      ),
      learn(
        'ri_hb2',
        1,
        'Leaving groups',
        'Can rank halides as leaving groups and explain why.',
        ['Leaving groups'],
        'contrast',
        'done',
      ),
      learn(
        'ri_hb3',
        2,
        'SN2 mechanism',
        'Can draw the one-step SN2 mechanism with backside attack.',
        ['SN2 mechanism'],
        'worked_example',
        'current',
      ),
      checkpoint('ri_hb4', 3, 'Checkpoint 1', ['Nucleophiles', 'Leaving groups', 'SN2 mechanism']),
      learn(
        'ri_hb5',
        4,
        'E2 eliminations',
        'Can predict the alkene an E2 elimination gives.',
        ['E2 mechanism'],
        'predict',
        'todo',
      ),
      checkpoint('ri_hb6', 5, 'Final checkpoint', ['SN2 mechanism', 'E2 mechanism']),
    ],
  }
  const scratch: Roadmap = {
    id: 'rm_orgo_scratch',
    subjectId: 'sub_orgo',
    title: 'Organic chemistry from scratch',
    goal: 'Get comfortable with the basics of organic chemistry',
    startReason: 'Nothing captured yet for this subject, so we start at the very beginning.',
    offerPlacement: true,
    estimatedMinutes: 35,
    status: 'active',
    carry: [],
    nextMilestone: null,
    createdAt: isoAgo(19 * DAY),
    updatedAt: isoAgo(12 * DAY + 2 * HOUR),
    items: [
      learn(
        'ri_hs1',
        0,
        'Functional groups',
        'Can name the common functional groups on sight.',
        ['Functional groups'],
        'big_picture',
        'done',
      ),
      learn(
        'ri_hs2',
        1,
        'Naming organic molecules',
        'Can give the IUPAC name of a simple chain.',
        ['IUPAC naming'],
        'worked_example',
        'current',
      ),
      learn(
        'ri_hs3',
        2,
        'Isomers',
        'Can tell structural isomers from stereoisomers.',
        ['Isomers'],
        'contrast',
        'todo',
      ),
      checkpoint('ri_hs4', 3, 'Checkpoint 1', ['Functional groups', 'IUPAC naming', 'Isomers']),
      learn(
        'ri_hs5',
        4,
        'Reaction types',
        'Can tell substitution, addition and elimination apart.',
        ['Reaction types'],
        'big_picture',
        'todo',
      ),
    ],
  }
  return [
    {
      roadmap: basics,
      replacedAt: isoAgo(5 * DAY),
      replacedBy: 'rm_orgo',
      reason: 'Replanned: focus on SN1, skip E2',
    },
    {
      roadmap: scratch,
      replacedAt: isoAgo(12 * DAY),
      replacedBy: basics.id,
      reason: 'New roadmap: Pass the midterm',
    },
  ]
}

/** The database's roadmap history, seeded on first use (the demo's Organic Chemistry has two). */
export function historyOf(db: MockDb): RoadmapVersion[] {
  let list = histories.get(db)
  if (!list) {
    list = db.subjects.some((s) => s.id === 'sub_orgo') ? demoHistory() : []
    histories.set(db, list)
  }
  return list
}

/** The roadmap the subject page shows: the open one, else the newest. */
function currentRoadmap(db: MockDb, subjectId: string): Roadmap | null {
  const open = roadmapFor(db, subjectId)
  if (open) return open
  const all = db.roadmaps.filter((r) => r.subjectId === subjectId)
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0] ?? null
}

function restore(ctx: MockContext, id: string) {
  const { db } = ctx
  const history = historyOf(db)
  const at = history.findIndex((v) => v.roadmap.id === id)
  const version = history[at]
  if (!version) throw new Error('That earlier version no longer exists.')
  const subjectId = version.roadmap.subjectId
  const now = nowIso()
  const current = currentRoadmap(db, subjectId)
  history.splice(at, 1)
  const restored: Roadmap = {
    ...version.roadmap,
    status: version.roadmap.status === 'done' ? 'done' : 'active',
    updatedAt: now,
  }
  const replaced: string[] = []
  if (current) {
    db.roadmaps = db.roadmaps.filter((r) => r.id !== current.id)
    history.unshift({
      roadmap: current,
      replacedAt: now,
      replacedBy: restored.id,
      reason: 'Swapped for an earlier version',
    })
    replaced.push(current.id)
    if (db.sessionRoadmapId === current.id) db.sessionRoadmapId = restored.id
  }
  db.roadmaps.push(restored)
  ctx.changed('roadmaps', [subjectId])
  return { restored: structuredClone(restored), replaced }
}

export const roadmapsHandlers: HandlerMap<RoadmapsChannel> = {
  'roadmaps.history': (ctx, subjectId) =>
    structuredClone(
      historyOf(ctx.db)
        .filter((v) => v.roadmap.subjectId === subjectId)
        .sort((a, b) => b.replacedAt.localeCompare(a.replacedAt)),
    ),
  'roadmaps.restore': restore,
}
