/**
 * Chat tools `read` and `search`: the double-tap chat's view of everything Dumbledore knows about
 * the student (subjects, the topic tree, notes, roadmaps with every step, quizzes, gaps, feedback,
 * chat, screen captures, assignments, profile, settings, the study session).
 *
 * Results are compact JSON for the model: ids always included, long text clipped, lists capped by
 * `limit` (default 20, at most 50). Reads never write and never emit events, and never return a
 * secret: settings drop anything key-, credential- or route-like, URLs lose their query string.
 */
import type { MemoryControl, QueryService, Repos, StudyService } from '@engine/contracts'
import { roadmapHistory } from '@engine/learning/study/roadmap-history'
import type {
  Concept,
  Encounter,
  Episode,
  Id,
  Note,
  Quiz,
  Roadmap,
  RoadmapItem,
  SourceRef,
} from '@shared/domain'
import type { TopicSource } from '@shared/state'
import { z } from 'zod'
import { openRoadmaps, roadmapProgress } from '../flows/context'
import { type ChatTool, defineTool, failure, outcome, short } from './types'

export interface ReadToolsDeps {
  repos: Repos
  queries: Pick<QueryService, 'subjects'>
  memory: Pick<MemoryControl, 'tree' | 'looseNotes'>
  /** The current study session; absent = `session` reads as none. */
  study?: Pick<StudyService, 'current'>
  nowIso: () => string
}

export const READ_KINDS = [
  'subjects',
  'subject',
  'topic',
  'notes',
  'note',
  'roadmaps',
  'roadmap',
  'roadmap_history',
  'quizzes',
  'exams',
  'quiz',
  'gaps',
  'encounters',
  'encounter',
  'episodes',
  'assignments',
  'feedback',
  'nudges',
  'chat',
  'profile',
  'settings',
  'session',
] as const
export type ReadKind = (typeof READ_KINDS)[number]

const DEFAULT_LIMIT = 20
const MAX_LIMIT = 50
/** Topics listed in `subject` (the tree is the map the model navigates, so more than `limit`). */
const MAX_TREE = 80
const EPISODE_TEXT = 600
const RECENT_DAYS = 7
const ASK_THREAD = 'ask'
/** Rows fetched for a capped list, so the result can say how many more there are. */
const FETCH = 200

export const ReadInput = z.object({
  kind: z.enum(READ_KINDS),
  id: z.string().nullable(),
  subjectId: z.string().nullable(),
  conceptId: z.string().nullable(),
  limit: z.number().nullable(),
})
export type ReadInput = z.infer<typeof ReadInput>

export const SearchInput = z.object({
  query: z.string().min(1),
  limit: z.number().nullable(),
})

const READ_DESCRIPTION = `Read anything Dumbledore knows about the student. Pass kind, plus id / subjectId / conceptId / limit (null when unused; limit defaults to ${DEFAULT_LIMIT}, max ${MAX_LIMIT}). Kinds:
- subjects: every subject (active, suggested, archived) with id, status, goal, deadline, mastery, progress and its open roadmaps.
- subject (id): one subject: fields, study preferences, topic tree (topics and subtopics with ids, big picture, gap, mastery, sources), all roadmaps with progress, assignments, recent exam results.
- topic (id = topic/concept id): the topic with its big picture, parent, subtopics, notes, sources, prerequisites and recent encounters.
- notes (subjectId and/or conceptId; both null = loose notes that match no subject), note (id).
- roadmaps (subjectId, null = every subject): all roadmaps, active, paused and done (the roadmap history), each with progress ("step 3 of 6, 2 done") and steps. roadmap (id): every step with its id, kind, objective or what it covers, status, and which one is current. roadmap_history (subjectId): earlier versions of the subject's roadmap that were replaced (replanned, a new roadmap, swapped), newest first, with when and why; act restore_roadmap_version brings one back.
- quizzes (subjectId): every quiz incl. checkpoints and placements; exams (subjectId): exams and reviews; quiz (id): questions, the student's answers, score.
- gaps (subjectId or null): struggling topics, misconceptions, open questions, roadmap carry.
- encounters (subjectId; null = all, incl. the inbox): extracted learning records; encounter (id).
- episodes: screen text captured in the last ${RECENT_DAYS} days (clipped).
- assignments (subjectId), feedback (what the student told Dumbledore about itself), nudges (last ${RECENT_DAYS} days), chat (recent messages of this chat), profile, settings, session (the study session running now).
Search hits map to kinds: subject → subject, concept → topic, encounter → encounter, exam → quiz. Ids in these results are the only valid ids for create, update, delete and act; never invent one.`

const SEARCH_DESCRIPTION =
  'Full-text search over subjects, topics (and their notes), encounters and exams. Returns hits with kind (subject, concept, encounter, exam), id, title, snippet and subjectId; read the hit (concept → read topic, exam → read quiz) for details. limit defaults to 20, max 50.'

// ─── Small helpers ──────────────────────────────────────────────────────────────────────────

const capOf = (limit: number | null): number =>
  Math.min(MAX_LIMIT, Math.max(1, Math.round(limit ?? DEFAULT_LIMIT)))

/** The first `cap` items mapped, under `name`, plus how many were left out. */
function capped<T, U>(name: string, items: readonly T[], cap: number, map: (item: T) => U) {
  const out: Record<string, unknown> = { [name]: items.slice(0, cap).map(map) }
  if (items.length > cap) out[`${name}More`] = items.length - cap
  return out
}

const pct = (x: number): number => Math.round(x * 100)
const day = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 10) : null)
const minute = (iso: string | null | undefined): string | null => (iso ? iso.slice(0, 16) : null)
const clip = (text: string | null | undefined, max: number): string | null =>
  text ? short(text, max) : null

/** A URL without its query string or fragment (tokens hide there), clipped. */
function cleanUrl(url: string | null | undefined): string | null {
  const u = url?.trim()
  if (!u) return null
  return short(u.replace(/[?#].*$/, ''), 120)
}

const source = (s: SourceRef) => ({ app: s.app, title: clip(s.title, 80), url: cleanUrl(s.url) })
const sources = (list: readonly TopicSource[] | undefined, max = 3) =>
  (list ?? []).slice(0, max).map((s) => ({ title: clip(s.title, 80), url: cleanUrl(s.url) }))

const notFound = (kind: string, id: string, listKind: string) =>
  failure(`No ${kind} with id ${id}; read ${listKind} first`)
const needsId = (kind: string, listKind: string) =>
  failure(`read ${kind} needs an id; read ${listKind} first`)

// ─── Shapes ─────────────────────────────────────────────────────────────────────────────────

const noteOut = (n: Note) => ({
  id: n.id,
  kind: n.kind,
  text: clip(n.text, 200),
  subjectId: n.subjectId,
  conceptId: n.conceptId,
  ...(n.status !== 'active' ? { status: n.status } : {}),
  ...(n.pinned ? { pinned: true } : {}),
  source: n.source.app === 'Dumbledore' ? 'Dumbledore' : clip(n.source.title ?? n.source.app, 60),
  createdAt: day(n.createdAt),
})

function stepOut(item: RoadmapItem, n: number, full: boolean) {
  const base = {
    id: item.id,
    n,
    kind: item.kind,
    title: clip(item.title, 100),
    status: item.status,
  }
  if (!full) return base
  return item.kind === 'learn'
    ? {
        ...base,
        idx: item.idx,
        objective: clip(item.objective, 200),
        concepts: item.concepts.slice(0, 8),
        move: item.move,
      }
    : {
        ...base,
        idx: item.idx,
        covers: item.covers.slice(0, 10),
        nQuestions: item.nQuestions,
        quizId: item.quizId,
        score: item.score,
      }
}

/** The current step (else the first to do), or null when every step is finished. */
function currentStep(r: Roadmap) {
  const at = r.items.findIndex((i) => i.status === 'current')
  const next = at >= 0 ? at : r.items.findIndex((i) => i.status === 'todo')
  if (next < 0) return null
  const item = r.items[next]
  return item ? { id: item.id, n: next + 1, title: clip(item.title, 100) } : null
}

const roadmapLine = (r: Roadmap) => ({
  id: r.id,
  title: clip(r.title, 80),
  status: r.status,
  progress: roadmapProgress(r),
})

function roadmapOut(r: Roadmap, steps: 'none' | 'short' | 'full') {
  return {
    ...roadmapLine(r),
    subjectId: r.subjectId,
    goal: clip(r.goal, 160),
    current: currentStep(r),
    ...(steps !== 'none'
      ? { steps: r.items.map((i, k) => stepOut(i, k + 1, steps === 'full')) }
      : {}),
    ...(r.carry.length ? { carry: r.carry.slice(0, 10) } : {}),
    updatedAt: day(r.updatedAt),
  }
}

const statusRank: Record<Roadmap['status'], number> = { active: 0, paused: 1, done: 2 }
const byRoadmapOrder = (a: Roadmap, b: Roadmap) =>
  statusRank[a.status] - statusRank[b.status] || b.updatedAt.localeCompare(a.updatedAt)

const quizSummary = (q: Quiz) => ({
  id: q.id,
  kind: q.kind,
  title: clip(q.title, 80),
  subjectIds: q.subjectIds,
  status: q.status,
  questions: q.questions.length,
  answered: q.answers.length,
  correct: q.answers.filter((a) => a.correct).length,
  score: q.score,
  ...(q.roadmapId ? { roadmapId: q.roadmapId } : {}),
  createdAt: day(q.createdAt),
  completedAt: day(q.completedAt),
})

function quizOut(q: Quiz) {
  const answers = new Map(q.answers.map((a) => [a.questionId, a]))
  return {
    ...quizSummary(q),
    roadmapItemId: q.roadmapItemId,
    questions: q.questions.map((question) => {
      const answer = answers.get(question.id)
      return {
        id: question.id,
        concept: question.conceptName,
        conceptId: question.conceptId,
        stem: clip(question.stem, 240),
        options: question.options.map((o) => clip(o, 100)),
        correctIndex: question.correctIndex,
        why: clip(question.rationales[question.correctIndex], 200),
        chosenIndex: answer ? answer.chosenIndex : null,
        correct: answer ? answer.correct : null,
      }
    }),
  }
}

const encounterOut = (e: Encounter, full = false) => ({
  id: e.id,
  subjectId: e.subjectId,
  conceptId: e.conceptId,
  inboxState: e.inboxState,
  seen: clip(e.seen, full ? 500 : 200),
  bigPicture: clip(e.bigPicture, full ? 400 : 200),
  topicPath: e.topicPath.slice(0, 5),
  understanding: e.understanding,
  ...(full ? { evidence: clip(e.evidence, 300), keyTerms: e.keyTerms.slice(0, 10) } : {}),
  openQuestions: e.openQuestions.slice(0, full ? 8 : 3).map((q) => clip(q, 160)),
  source: source(e.source),
  minutes: Math.round(e.dwellSeconds / 60),
  createdAt: minute(e.createdAt),
})

const episodeOut = (e: Episode) => ({
  id: e.id,
  app: e.app,
  title: clip(e.title, 100),
  url: cleanUrl(e.url),
  kind: e.kind,
  startedAt: minute(e.startedAt),
  minutes: Math.round(e.dwellSeconds / 60),
  extracted: e.extracted,
  text: clip(e.text, EPISODE_TEXT) ?? '',
  ...(e.signals.highlights.length
    ? { highlights: e.signals.highlights.slice(0, 5).map((h) => clip(h, 160)) }
    : {}),
  ...(e.signals.aiQuestions.length
    ? { aiQuestions: e.signals.aiQuestions.slice(0, 5).map((q) => clip(q, 160)) }
    : {}),
})

// ─── Settings without secrets ───────────────────────────────────────────────────────────────

/** Field names that may hold a key, credential or model route; dropped unless boolean. */
const SECRET_NAME =
  /(api[-_]?key|.key$|keys$|secret|token|passw|credential|auth|cookie|bearer|route|override)/i
/** Values that look like an API key whatever the field is called. */
const SECRET_VALUE =
  /^(sk-|sk_|AIza|gsk_|xox[abp]-|ghp_|github_pat_|Bearer\s)|^[A-Za-z0-9_\-+/=]{32,}$/

/** A deep copy without secret-ish fields or values (keys live in the Keychain; be defensive). */
export function withoutSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.filter((v) => !isSecretValue(v)).map(withoutSecrets)
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      if (typeof v !== 'boolean' && SECRET_NAME.test(k)) continue
      if (isSecretValue(v)) continue
      out[k] = withoutSecrets(v)
    }
    return out
  }
  return value
}

const isSecretValue = (v: unknown): boolean => typeof v === 'string' && SECRET_VALUE.test(v.trim())

// ─── The tools ──────────────────────────────────────────────────────────────────────────────

export function createReadTools(deps: ReadToolsDeps): ChatTool[] {
  const { repos } = deps
  const recentIso = () =>
    new Date(Date.parse(deps.nowIso()) - RECENT_DAYS * 24 * 60 * 60 * 1000).toISOString()

  const subjectName = (id: Id | null): string | null =>
    id ? (repos.subjects.get(id)?.name ?? null) : null

  const allRoadmaps = (subjectId: Id | null): Roadmap[] =>
    (subjectId ? [subjectId] : repos.subjects.list().map((s) => s.id))
      .flatMap((id) => repos.roadmaps.listBySubject(id))
      .sort(byRoadmapOrder)

  const findEncounter = (id: Id): Encounter | null =>
    repos.encounters.list({}).find((e) => e.id === id) ?? null

  function readSubjects() {
    const all = deps.queries.subjects()
    const rank = { active: 0, suggested: 1, archived: 2 } as const
    const sorted = [...all].sort((a, b) => rank[a.status] - rank[b.status])
    return capped('subjects', sorted, MAX_LIMIT, (s) => ({
      id: s.id,
      name: s.name,
      emoji: s.emoji,
      status: s.status,
      goal: clip(s.goal, 160),
      deadline: day(s.deadline),
      description: clip(s.description, 160),
      mastery: pct(s.mastery),
      progress: pct(s.progress),
      dueReviews: s.dueReviews,
      openQuestions: s.openQuestions,
      lastStudiedAt: day(s.lastStudiedAt),
      openRoadmaps: openRoadmaps(repos, s.id).slice(0, 3).map(roadmapLine),
    }))
  }

  function readSubject(id: Id) {
    const subject = repos.subjects.get(id) ?? repos.subjects.findByName(id)
    if (!subject) return notFound('subject', id, 'subjects')
    const summary = deps.queries.subjects().find((s) => s.id === subject.id)
    const prefs = repos.subjects.studyPreferences(subject.id)
    const tree = deps.memory.tree(subject.id)
    const depth = new Map<Id, number>()
    const names = new Map(tree.concepts.map((n) => [n.concept.id, n.concept.name]))
    const topics = tree.concepts.map(({ concept: c, notes, sources: src }) => {
      const d = c.parentId && depth.has(c.parentId) ? (depth.get(c.parentId) ?? 0) + 1 : 0
      depth.set(c.id, d)
      return {
        id: c.id,
        name: c.name,
        parentId: c.parentId,
        depth: d,
        status: c.status,
        ...(c.status === 'struggling' ? { gap: true } : {}),
        mastery: pct(c.mastery),
        bigPicture: clip(c.summary, 160),
        ...(c.summaryPinned ? { summaryPinned: true } : {}),
        notes: notes.length,
        sources: sources(src, 2),
      }
    })
    const exams = repos.quizzes
      .list({ subjectId: subject.id, limit: 10 })
      .filter((q) => q.kind === 'exam' || q.kind === 'review')
      .slice(0, 5)
    return outcome({
      kind: 'subject',
      subject: {
        id: subject.id,
        name: subject.name,
        emoji: subject.emoji,
        status: subject.status,
        focus: subject.focus,
        goal: clip(subject.goal, 240),
        deadline: day(subject.deadline),
        description: clip(subject.description, 400),
        ...(summary
          ? {
              mastery: pct(summary.mastery),
              progress: pct(summary.progress),
              dueReviews: summary.dueReviews,
              openQuestions: summary.openQuestions,
              studyMinutesWeek: summary.studyMinutesWeek,
              lastStudiedAt: day(summary.lastStudiedAt),
            }
          : {}),
      },
      studyPreferences: prefs
        ? {
            instruction: clip(prefs.instruction, 300),
            focus: prefs.focus.map((c) => ({ id: c, name: names.get(c) ?? null })),
            skip: prefs.skip.map((c) => ({ id: c, name: names.get(c) ?? null })),
            focusNames: prefs.focusNames,
            skipNames: prefs.skipNames,
          }
        : null,
      ...capped('topics', topics, MAX_TREE, (t) => t),
      unplacedNotes: tree.unplaced.length,
      prerequisites: tree.edges
        .slice(0, 30)
        .map((e) => `${names.get(e.fromId) ?? e.fromId} → ${names.get(e.toId) ?? e.toId}`),
      roadmaps: allRoadmaps(subject.id)
        .slice(0, 10)
        .map((r) => roadmapOut(r, 'none')),
      assignments: repos.assignments.list({ subjectId: subject.id, limit: 10 }).map((a) => ({
        id: a.id,
        title: clip(a.title, 100),
        dueAt: day(a.dueAt),
        status: a.status,
      })),
      recentExams: exams.map(quizSummary),
    })
  }

  function readTopic(id: Id) {
    const concept = repos.concepts.get(id)
    if (!concept) return notFound('topic', id, 'subject (its topic tree)')
    const tree = deps.memory.tree(concept.subjectId)
    const node = tree.concepts.find((n) => n.concept.id === id)
    const byId = new Map<Id, Concept>(tree.concepts.map((n) => [n.concept.id, n.concept]))
    const parent = concept.parentId ? byId.get(concept.parentId) : undefined
    const name = (cid: Id) => byId.get(cid)?.name ?? cid
    const notes = node?.notes ?? repos.notes.list({ conceptId: id })
    const encounters = repos.encounters
      .list({ subjectId: concept.subjectId, limit: 200 })
      .filter((e) => e.conceptId === id)
      .slice(0, 5)
    return outcome({
      kind: 'topic',
      topic: {
        id: concept.id,
        name: concept.name,
        subjectId: concept.subjectId,
        subjectName: subjectName(concept.subjectId),
        bigPicture: clip(concept.summary, 600),
        ...(concept.summaryPinned ? { summaryPinned: true } : {}),
        status: concept.status,
        ...(concept.status === 'struggling' ? { gap: true } : {}),
        mastery: pct(concept.mastery),
        struggleCount: concept.struggleCount,
        nextReviewAt: day(concept.nextReviewAt),
        lastSeenAt: day(concept.lastSeenAt),
      },
      parent: parent ? { id: parent.id, name: parent.name } : null,
      subtopics: tree.concepts
        .filter((n) => n.concept.parentId === id)
        .map((n) => ({ id: n.concept.id, name: n.concept.name, status: n.concept.status })),
      ...capped('notes', [...notes].reverse(), 30, noteOut),
      sources: sources(node?.sources, 8),
      prerequisites: tree.edges
        .filter((e) => e.toId === id)
        .map((e) => ({ id: e.fromId, name: name(e.fromId), why: clip(e.why, 120) })),
      leadsTo: tree.edges
        .filter((e) => e.fromId === id)
        .map((e) => ({ id: e.toId, name: name(e.toId) })),
      recentEncounters: encounters.map((e) => encounterOut(e)),
    })
  }

  function readNotes(subjectId: Id | null, conceptId: Id | null, cap: number) {
    if (conceptId && !repos.concepts.get(conceptId))
      return notFound('topic', conceptId, 'subject (its topic tree)')
    if (subjectId && !repos.subjects.get(subjectId))
      return notFound('subject', subjectId, 'subjects')
    const notes = conceptId
      ? repos.notes.list({ conceptId }).reverse()
      : subjectId
        ? repos.notes.list({ subjectId }).reverse()
        : deps.memory.looseNotes()
    return outcome({
      kind: 'notes',
      scope: conceptId ? 'topic' : subjectId ? 'subject' : 'loose',
      ...capped('notes', notes, cap, noteOut),
    })
  }

  function readGaps(subjectId: Id | null, cap: number) {
    if (subjectId && !repos.subjects.get(subjectId))
      return notFound('subject', subjectId, 'subjects')
    const subjects = subjectId
      ? [subjectId]
      : repos.subjects.list({ status: ['active', 'suggested'] }).map((s) => s.id)
    const struggling = subjectId
      ? repos.concepts
          .listBySubject(subjectId)
          .filter((c) => c.status === 'struggling')
          .sort((a, b) => b.struggleCount - a.struggleCount)
      : repos.concepts.listStruggling(cap)
    const gapNotes = subjects
      .flatMap((id) => repos.notes.list({ subjectId: id, status: 'active' }))
      .filter((n) => n.kind === 'misconception' || n.kind === 'question')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    const openQuestions = subjects.flatMap((id) =>
      repos.encounters.openQuestions(id, 5).map((q) => ({ subjectId: id, question: clip(q, 160) })),
    )
    const carry = subjects.flatMap((id) =>
      openRoadmaps(repos, id)
        .filter((r) => r.carry.length > 0)
        .map((r) => ({ roadmapId: r.id, subjectId: id, concepts: r.carry.slice(0, 10) })),
    )
    return outcome({
      kind: 'gaps',
      ...capped('struggling', struggling, cap, (c) => ({
        id: c.id,
        name: c.name,
        subjectId: c.subjectId,
        mastery: pct(c.mastery),
        struggleCount: c.struggleCount,
      })),
      ...capped('notes', gapNotes, cap, noteOut),
      ...capped('openQuestions', openQuestions, cap, (q) => q),
      roadmapCarry: carry,
    })
  }

  function readSession() {
    const s = deps.study?.current() ?? null
    if (!s) return outcome({ kind: 'session', session: null })
    const item = s.items[s.index]
    return outcome({
      kind: 'session',
      session: {
        roadmapId: s.roadmapId,
        subjectId: s.subjectId,
        subjectName: s.subjectName,
        title: clip(s.title, 100),
        phase: s.phase,
        step: `${Math.min(s.index + 1, s.total)} of ${s.total}`,
        current: item ? { id: item.id, title: clip(item.title, 100), kind: item.kind } : null,
        nextAction: s.nextAction,
        assistant: s.assistant,
        error: clip(s.error, 200),
      },
    })
  }

  function read(input: ReadInput) {
    const cap = capOf(input.limit)
    const { id, subjectId, conceptId } = input
    if (subjectId && input.kind !== 'notes' && input.kind !== 'gaps') {
      if (!repos.subjects.get(subjectId)) return notFound('subject', subjectId, 'subjects')
    }
    switch (input.kind) {
      case 'subjects':
        return outcome({ kind: 'subjects', ...readSubjects() })
      case 'subject':
        return id ? readSubject(id) : needsId('subject', 'subjects')
      case 'topic': {
        const topicId = id ?? conceptId
        return topicId ? readTopic(topicId) : needsId('topic', 'subject (its topic tree)')
      }
      case 'notes':
        return readNotes(subjectId, conceptId, cap)
      case 'note': {
        if (!id) return needsId('note', 'notes')
        const note = repos.notes.get(id)
        return note ? outcome({ kind: 'note', note: noteOut(note) }) : notFound('note', id, 'notes')
      }
      case 'roadmaps':
        return outcome({
          kind: 'roadmaps',
          ...capped('roadmaps', allRoadmaps(subjectId), cap, (r) =>
            roadmapOut(r, r.status === 'done' ? 'none' : 'short'),
          ),
        })
      case 'roadmap': {
        if (!id) return needsId('roadmap', 'roadmaps')
        const r = repos.roadmaps.get(id)
        if (!r) return notFound('roadmap', id, 'roadmaps')
        return outcome({
          kind: 'roadmap',
          roadmap: {
            ...roadmapOut(r, 'full'),
            subjectName: subjectName(r.subjectId),
            startReason: clip(r.startReason, 200),
            estimatedMinutes: r.estimatedMinutes,
            nextMilestone: clip(r.nextMilestone, 160),
            createdAt: day(r.createdAt),
          },
        })
      }
      case 'roadmap_history': {
        if (!subjectId)
          return failure('read roadmap_history needs a subjectId; read subjects first')
        const versions = roadmapHistory(repos, subjectId)
        return outcome({
          kind: 'roadmap_history',
          subjectId,
          ...capped('versions', versions, cap, (v) => ({
            versionId: v.roadmap.id,
            title: clip(v.roadmap.title, 80),
            status: v.roadmap.status,
            progress: roadmapProgress(v.roadmap),
            steps: v.roadmap.items.length,
            replacedAt: minute(v.replacedAt),
            replacedBy: v.replacedBy,
            reason: clip(v.reason, 120),
          })),
        })
      }
      case 'quizzes':
      case 'exams': {
        const all = repos.quizzes
          .list({ subjectId: subjectId ?? undefined })
          .filter((q) => input.kind === 'quizzes' || q.kind === 'exam' || q.kind === 'review')
        return outcome({ kind: input.kind, ...capped(input.kind, all, cap, quizSummary) })
      }
      case 'quiz': {
        if (!id) return needsId('quiz', 'quizzes')
        const q = repos.quizzes.get(id)
        return q ? outcome({ kind: 'quiz', quiz: quizOut(q) }) : notFound('quiz', id, 'quizzes')
      }
      case 'gaps':
        return readGaps(subjectId, cap)
      case 'encounters': {
        const list = repos.encounters.list({ subjectId: subjectId ?? undefined, limit: FETCH })
        return outcome({
          kind: 'encounters',
          ...capped('encounters', list, cap, (e) => encounterOut(e)),
        })
      }
      case 'encounter': {
        if (!id) return needsId('encounter', 'encounters')
        const e = findEncounter(id)
        return e
          ? outcome({ kind: 'encounter', encounter: encounterOut(e, true) })
          : notFound('encounter', id, 'encounters')
      }
      case 'episodes': {
        const list = repos.episodes.recent({ sinceIso: recentIso(), limit: FETCH })
        return outcome({ kind: 'episodes', ...capped('episodes', list, cap, episodeOut) })
      }
      case 'assignments': {
        const list = repos.assignments.list({ subjectId: subjectId ?? undefined })
        return outcome({
          kind: 'assignments',
          ...capped('assignments', list, cap, (a) => ({
            id: a.id,
            title: clip(a.title, 120),
            subjectId: a.subjectId,
            course: clip(a.course, 60),
            dueAt: day(a.dueAt),
            status: a.status,
          })),
        })
      }
      case 'feedback': {
        const list = repos.feedback.recent({ limit: cap })
        return outcome({
          kind: 'feedback',
          feedback: list.map((f) => ({
            id: f.id,
            scope: f.scope,
            subjectId: f.subjectId,
            text: clip(f.text, 300),
            createdAt: day(f.createdAt),
          })),
        })
      }
      case 'nudges': {
        const list = repos.nudges.listSince(recentIso()).reverse()
        return outcome({
          kind: 'nudges',
          ...capped('nudges', list, cap, (n) => ({
            id: n.id,
            kind: n.kind,
            title: clip(n.title, 100),
            body: clip(n.body, 200),
            outcome: n.outcome,
            createdAt: minute(n.createdAt),
          })),
        })
      }
      case 'chat': {
        const thread = id ?? ASK_THREAD
        const list = repos.chat.history(thread, cap)
        return outcome({
          kind: 'chat',
          thread,
          messages: list.map((m) => ({
            id: m.id,
            role: m.role,
            content: clip(m.content, 400),
            ...(m.actions.length ? { actions: m.actions.map((a) => a.type) } : {}),
            at: minute(m.createdAt),
          })),
        })
      }
      case 'profile': {
        const p = repos.profile.get()
        return outcome({
          kind: 'profile',
          profile: {
            aboutMe: clip(p.aboutMe, 600),
            level: p.level,
            promptLanguage: p.promptLanguage,
            summary: clip(p.summary, 800),
            habits: p.habits,
            updatedAt: day(p.updatedAt),
          },
        })
      }
      case 'settings':
        return outcome({ kind: 'settings', settings: withoutSecrets(repos.settings.get()) })
      case 'session':
        return readSession()
    }
  }

  return [
    defineTool({
      name: 'read',
      description: READ_DESCRIPTION,
      input: ReadInput,
      run(input) {
        try {
          return read(input)
        } catch (err) {
          return failure(`read ${input.kind} failed: ${short((err as Error).message, 160)}`)
        }
      },
    }),
    defineTool({
      name: 'search',
      description: SEARCH_DESCRIPTION,
      input: SearchInput,
      run(input) {
        try {
          const cap = capOf(input.limit)
          const hits = repos.search.query(input.query, cap)
          return outcome({
            query: input.query,
            hits: hits.map((h) => ({
              kind: h.kind,
              id: h.id,
              title: clip(h.title, 100),
              snippet: clip(h.snippet, 160),
              subjectId: h.subjectId,
            })),
          })
        } catch (err) {
          return failure(`search failed: ${short((err as Error).message, 160)}`)
        }
      },
    }),
  ] as ChatTool[]
}
