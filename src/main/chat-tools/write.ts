/**
 * Chat tools that write: create(kind, data), update(kind, id, patch) and delete(kind, id) on the
 * student's Dumbledore data. Writes act at once and come back with one receipt line and an Undo;
 * only a delete asks first, in plain text: the first call deletes nothing and returns the
 * question for the model to ask ("Delete the note “X” from Statistics? Say yes to delete it."),
 * and the delete is pending. The next turn's call with confirmed: true runs it only when that
 * delete is pending (asked within 15 minutes) and the student's message says yes (saysYes).
 *
 * Undo is generic: before a write, the rows it will touch are snapshotted (per kind: the subject,
 * the topics with what links to them, the note, the roadmaps, the settings or profile fields);
 * the Undo puts the snapshot back and announces it again. A create's Undo removes what it made.
 *
 * `data` and `patch` are JSON-object strings in the tool schema (the providers run strict JSON
 * schema, where a free-form object can't be expressed); they are parsed leniently and validated
 * with a strict schema per kind, so an unknown field fails and names the allowed ones.
 *
 * Roadmap steps are edited on the stored roadmap, which the study service re-reads before each of
 * its own writes, so an edit here is not overwritten by a running session. Marking the current
 * step done or skipped closes it the way the session does (closeItem: the next open step becomes
 * current, the roadmap is done when nothing is left open).
 */

import { parseJsonLenient } from '@engine/brain/llm/json'
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { newId } from '@engine/ids'
import { closeItem } from '@engine/learning/study/roadmap-ops'
import { subtreeIds } from '@engine/memory/sources'
import type { RelinkSupport } from '@engine/store/sqlite-repos'
import {
  type Assignment,
  type Concept,
  type ConceptEdge,
  FeedbackScope,
  Id,
  ItemStatus,
  type LearnItem,
  MasteryStatus,
  type Note,
  NoteKind,
  type Profile,
  type Roadmap,
  type RoadmapItem,
  type Settings,
  type Subject,
  SubjectStatus,
} from '@shared/domain'
import type { MemoryScope } from '@shared/state'
import { z } from 'zod'
import { type ChatTool, defineTool, failure, outcome, short, type ToolOutcome } from './types'
import type { UndoLog } from './undo'

export interface WriteToolsDeps {
  repos: Pick<
    Repos,
    | 'subjects'
    | 'concepts'
    | 'notes'
    | 'edges'
    | 'encounters'
    | 'quizzes'
    | 'feedback'
    | 'roadmaps'
    | 'assignments'
    | 'profile'
    | 'settings'
    | 'transaction'
  >
  bus: Pick<EngineBus, 'emit'>
  undo: Pick<UndoLog, 'remember'>
  /** Moving a topic to another subject and re-linking encounters on Undo (SqliteRepos.relink). */
  relink: Pick<RelinkSupport, 'moveConcept' | 'setEncounterConcept'> | null
  nowIso: () => string
}

export const WRITE_KINDS = [
  'subject',
  'topic',
  'note',
  'roadmap',
  'roadmap_step',
  'feedback',
  'assignment',
  'settings',
  'profile',
] as const
export type WriteKind = (typeof WRITE_KINDS)[number]

/** Where a note the chat writes says it came from. */
export const CHAT_NOTE_SOURCE: Note['source'] = {
  app: 'Dumbledore',
  bundleId: null,
  url: null,
  title: 'Told Dumbledore',
}

// ─── Input parsing and validation ─────────────────────────────────────────────────────────────

/** A refused or invalid write: becomes failure(message) for the model. */
class Refusal extends Error {}

const jsonField = (example: string) =>
  z.preprocess(
    (v) => (v !== null && typeof v === 'object' ? JSON.stringify(v) : v),
    z.string().describe(`JSON object, e.g. ${example}`),
  )

function parseObject(text: string, what: 'data' | 'patch'): Record<string, unknown> {
  const parsed = parseJsonLenient(text)
  const value = parsed.ok ? parsed.value : null
  if (value === null || typeof value !== 'object' || Array.isArray(value))
    throw new Refusal(`${what} must be a JSON object, e.g. {"name":"…"}`)
  return value as Record<string, unknown>
}

const isDay = (s: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const d = new Date(`${s}T00:00:00Z`)
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s
}
const isMoment = (s: string): boolean =>
  isDay(s) ||
  (/^\d{4}-\d{2}-\d{2}T/.test(s) && isDay(s.slice(0, 10)) && !Number.isNaN(Date.parse(s)))

const text = (max: number) =>
  z.string().trim().min(1, 'must not be empty').max(max, `at most ${max} characters`)
const longText = (max: number) => z.string().trim().max(max, `at most ${max} characters`)
const Day = z.string().trim().refine(isDay, 'must be a date YYYY-MM-DD')
const Moment = z.string().trim().refine(isMoment, 'must be YYYY-MM-DD or an ISO date-time')
const Position = z.number().int('must be a whole number').min(1, 'starts at 1')

const SubjectFields = z.strictObject({
  name: text(80),
  emoji: text(8),
  description: longText(2000),
  goal: longText(500).nullable(),
  deadline: Day.nullable(),
  status: SubjectStatus,
})
const SubjectCreate = SubjectFields.partial().required({ name: true })
const TopicCreate = z.strictObject({
  subjectId: Id,
  name: text(120),
  parentId: Id.nullable().optional(),
  summary: longText(1000).optional(),
})
const TopicPatch = z
  .strictObject({
    name: text(120),
    summary: longText(1000),
    parentId: Id.nullable(),
    subjectId: Id,
    status: MasteryStatus,
  })
  .partial()
const NoteCreate = z.strictObject({
  subjectId: Id.nullable().optional(),
  conceptId: Id.nullable().optional(),
  kind: NoteKind.optional(),
  text: text(200),
})
const NotePatch = z
  .strictObject({
    text: text(200),
    kind: NoteKind,
    subjectId: Id.nullable(),
    conceptId: Id.nullable(),
    pinned: z.boolean(),
  })
  .partial()
const RoadmapPatch = z
  .strictObject({ title: text(120), goal: text(500), status: z.enum(['active', 'paused', 'done']) })
  .partial()
const StepCreate = z.strictObject({
  roadmapId: Id,
  title: text(120),
  objective: text(500),
  position: Position.nullable().optional(),
})
const StepPatch = z
  .strictObject({ title: text(120), objective: text(500), status: ItemStatus, position: Position })
  .partial()
const FeedbackCreate = z.strictObject({
  text: text(300),
  scope: FeedbackScope.optional(),
  subjectId: Id.nullable().optional(),
})
const AssignmentStatus = z.enum(['open', 'done', 'dismissed'])
const AssignmentFields = z.strictObject({
  title: text(200),
  dueAt: Moment.nullable(),
  status: AssignmentStatus,
  subjectId: Id.nullable(),
})
const AssignmentCreate = AssignmentFields.partial().required({ title: true })
/** The settings the chat may change: nothing about AI, keys, providers or capture. */
const SettingsPatch = z
  .strictObject({
    focusSubjectId: Id.nullable(),
    focusTopicId: Id.nullable(),
    theme: z.enum(['system', 'light', 'dark']),
    timerMinutes: z.number().int().min(1).max(180),
  })
  .partial()
const ProfilePatch = z
  .strictObject({
    aboutMe: longText(2000),
    level: longText(100).nullable(),
    promptLanguage: z.enum(['auto', 'en', 'fi', 'sv']),
  })
  .partial()

function validate<S extends z.ZodObject>(
  schema: S,
  value: unknown,
  kind: WriteKind,
  hint = '',
): z.output<S> {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  const allowed = Object.keys(schema.shape).join(', ')
  const problems = parsed.error.issues.map((issue) => {
    if (issue.code === 'unrecognized_keys')
      return `${kind} has no field ${issue.keys.join(', ')}; allowed: ${allowed}${hint}`
    const at = issue.path.join('.')
    return at ? `${at}: ${issue.message}` : issue.message
  })
  throw new Refusal(problems.join('; '))
}

const nothingToChange = (schema: z.ZodObject) =>
  new Refusal(`patch changes nothing; allowed fields: ${Object.keys(schema.shape).join(', ')}`)

/** "2026-12-12" → "12 Dec 2026". */
function day(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

const q = (s: string, max = 60) => `“${short(s, max)}”`
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`
const LANGUAGES = { auto: 'automatic', en: 'English', fi: 'Finnish', sv: 'Swedish' } as const

// ─── Snapshots ────────────────────────────────────────────────────────────────────────────────

/** Topics as they were, with whatever links to them that the write may change. */
interface TopicSnapshot {
  concepts: Concept[]
  /** Topics outside `concepts` whose parent is one of them (a delete lifts them). */
  children: { id: Id; parentId: Id }[]
  notes: Pick<Note, 'id' | 'subjectId' | 'conceptId' | 'status'>[]
  edges: ConceptEdge[]
  encounters: { id: Id; conceptId: Id }[]
  questions: { quizId: Id; questionId: Id; conceptId: Id }[]
}

const CONCEPT_FIELDS = [
  'name',
  'summary',
  'parentId',
  'mastery',
  'box',
  'nextReviewAt',
  'status',
  'struggleCount',
  'lastSeenAt',
] as const

function pick<T extends object, K extends keyof T>(value: T, keys: readonly K[]): Pick<T, K> {
  const out = {} as Pick<T, K>
  for (const k of keys) out[k] = value[k]
  return out
}

/** The patch's keys whose value differs from the current one (undefined = not in the patch). */
function changedKeys<
  T extends object,
  P extends { [K in keyof P]: K extends keyof T ? T[K] : never },
>(current: T, patch: P): (keyof P & keyof T)[] {
  return (Object.keys(patch) as (keyof P & keyof T)[]).filter(
    (k) => patch[k] !== undefined && JSON.stringify(patch[k]) !== JSON.stringify(current[k]),
  )
}

// ─── The tools ────────────────────────────────────────────────────────────────────────────────

interface Deletion {
  /** The plain question the model asks first, naming the thing and saying what happens. */
  question: string
  run(): ToolOutcome
}

/** How long an asked delete waits for the student's yes. */
const CONFIRM_MS = 15 * 60_000

const YES =
  /^\s*(yes|y|yeah|yep|yup|sure|ok|okay|confirm(ed)?|do it|go ahead|delete it|please do|kyllä|joo|juu|ja|jo)\b/i
const NO = /\b(no|not|don'?t|do not|cancel|stop|wait|keep|ei|älä|nej)\b/i

/** The student's message is a yes to the question asked ("yes", "yep, delete it", "joo"). */
export function saysYes(message: string | undefined): boolean {
  const text = (message ?? '').trim()
  return YES.test(text) && !NO.test(text)
}

interface KindOps {
  create?(data: Record<string, unknown>): ToolOutcome
  update?(id: Id | null, patch: Record<string, unknown>): ToolOutcome
  remove?(id: Id): Deletion
  /** Why an operation is not offered for the kind (what to do instead). */
  refuse: Partial<Record<'create' | 'update' | 'delete', string>>
}

export function createWriteTools(deps: WriteToolsDeps): ChatTool[] {
  const { repos, bus, undo, relink, nowIso } = deps
  /** Deletes the model asked about ("kind:id" → when), waiting for the student's yes. */
  const asked = new Map<string, number>()

  const emit = (scope: MemoryScope, ids: (Id | null | undefined)[]) => {
    const clean = [...new Set(ids.filter((id): id is Id => !!id))]
    bus.emit('memory:changed', { scope, ids: clean })
  }
  const missing = (kind: string, id: Id | null) =>
    new Refusal(`No ${kind} with id ${id ?? 'null'}; read first`)
  /** Registers the Undo and builds the outcome with its receipt. */
  const wrote = (result: unknown, line: string, restore: () => void): ToolOutcome =>
    outcome(result, { receipts: [{ line, undoId: undo.remember(line, restore) }] })

  // ── lookups ──
  const mustSubject = (id: Id | null): Subject => {
    const s = id ? repos.subjects.get(id) : null
    if (!s) throw missing('subject', id)
    return s
  }
  const mustTopic = (id: Id | null): Concept => {
    const c = id ? repos.concepts.get(id) : null
    if (!c) throw missing('topic', id)
    return c
  }
  const mustNote = (id: Id | null): Note => {
    const n = id ? repos.notes.get(id) : null
    if (n?.status !== 'active') throw missing('note', id)
    return n
  }
  const mustRoadmap = (id: Id | null): Roadmap => {
    const r = id ? repos.roadmaps.get(id) : null
    if (!r) throw missing('roadmap', id)
    return r
  }
  const findStep = (id: Id | null): { roadmap: Roadmap; index: number } => {
    for (const s of repos.subjects.list())
      for (const roadmap of repos.roadmaps.listBySubject(s.id)) {
        const index = roadmap.items.findIndex((i) => i.id === id)
        if (index >= 0) return { roadmap, index }
      }
    throw missing('roadmap_step', id)
  }
  const mustAssignment = (id: Id | null): Assignment => {
    const a = repos.assignments.list({}).find((x) => x.id === id)
    if (!a) throw missing('assignment', id)
    return a
  }
  const placeName = (subjectId: Id | null, conceptId: Id | null): string => {
    if (!subjectId) return 'loose notes'
    const subject = repos.subjects.get(subjectId)?.name ?? 'a subject'
    const concept = conceptId ? repos.concepts.get(conceptId) : null
    return concept ? `${subject} › ${concept.name}` : subject
  }

  // ── subjects ──
  const subjectChanged = (id: Id) => emit('subjects', [id])
  const restoreSubject = (before: Pick<Subject, 'id'> & Partial<Subject>) => {
    if (!repos.subjects.get(before.id)) return
    const { id, ...fields } = before
    repos.subjects.update(id, fields)
    subjectChanged(id)
  }

  // ── topics ──
  const topicSnapshot = (ids: Id[], links: boolean): TopicSnapshot => {
    const concepts = ids.map(mustTopic)
    const snap: TopicSnapshot = {
      concepts,
      children: [],
      notes: [],
      edges: [],
      encounters: [],
      questions: [],
    }
    if (!links) return snap
    const set = new Set(ids)
    const subjects = [...new Set(concepts.map((c) => c.subjectId))]
    for (const subjectId of subjects) {
      for (const c of repos.concepts.listBySubject(subjectId))
        if (!set.has(c.id) && c.parentId && set.has(c.parentId))
          snap.children.push({ id: c.id, parentId: c.parentId })
      snap.edges.push(
        ...repos.edges.list(subjectId).filter((e) => set.has(e.fromId) || set.has(e.toId)),
      )
      for (const e of repos.encounters.list({ subjectId }))
        if (e.conceptId && set.has(e.conceptId))
          snap.encounters.push({ id: e.id, conceptId: e.conceptId })
      for (const quiz of repos.quizzes.list({ subjectId }))
        for (const question of quiz.questions)
          if (question.conceptId && set.has(question.conceptId))
            snap.questions.push({
              quizId: quiz.id,
              questionId: question.id,
              conceptId: question.conceptId,
            })
    }
    for (const id of ids)
      for (const n of repos.notes.list({ conceptId: id, status: null }))
        snap.notes.push(pick(n, ['id', 'subjectId', 'conceptId', 'status']))
    return snap
  }

  const restoreTopics = (snap: TopicSnapshot) => {
    const touched = new Set<Id>(snap.concepts.map((c) => c.subjectId))
    repos.transaction(() => {
      for (const c of snap.concepts) {
        const now = repos.concepts.get(c.id)
        if (!now) repos.concepts.restore(c)
        else if (now.subjectId !== c.subjectId) {
          touched.add(now.subjectId)
          if (!relink) throw new Error('Moving a topic back is not available here')
          relink.moveConcept(c.id, c.subjectId)
        }
      }
      for (const c of snap.concepts)
        repos.concepts.update(c.id, {
          ...pick(c, CONCEPT_FIELDS),
          summaryPinned: c.summaryPinned ?? false,
        })
      for (const child of snap.children)
        if (repos.concepts.get(child.id))
          repos.concepts.update(child.id, { parentId: child.parentId })
      for (const n of snap.notes) {
        const now = repos.notes.get(n.id)
        if (!now) continue
        const { id, ...fields } = n
        if (changedKeys(now, fields).length > 0) repos.notes.update(id, fields)
      }
      for (const e of snap.edges) {
        const from = repos.concepts.get(e.fromId)
        if (!from || !repos.concepts.get(e.toId)) continue
        const there = repos.edges
          .list(from.subjectId)
          .some((x) => x.fromId === e.fromId && x.toId === e.toId)
        if (!there)
          repos.edges.add({ fromId: e.fromId, toId: e.toId, why: e.why, source: e.source })
      }
      for (const e of snap.encounters) relink?.setEncounterConcept(e.id, e.conceptId)
      for (const quizId of new Set(snap.questions.map((x) => x.quizId))) {
        const quiz = repos.quizzes.get(quizId)
        if (!quiz) continue
        const want = new Map(
          snap.questions.filter((x) => x.quizId === quizId).map((x) => [x.questionId, x.conceptId]),
        )
        let relinked = false
        quiz.questions = quiz.questions.map((question) => {
          const conceptId = want.get(question.id)
          if (!conceptId || conceptId === question.conceptId) return question
          relinked = true
          return { ...question, conceptId }
        })
        if (relinked) repos.quizzes.save(quiz)
      }
    })
    emit(
      'concepts',
      snap.concepts.map((c) => c.id),
    )
    emit('subjects', [...touched])
  }

  // ── notes ──
  const noteChanged = (...places: Pick<Note, 'subjectId' | 'conceptId'>[]) => {
    const subjects = places.map((p) => p.subjectId)
    if (subjects.some((s) => s)) emit('subjects', subjects)
    if (subjects.some((s) => !s)) emit('inbox', [])
    const concepts = places.map((p) => p.conceptId)
    if (concepts.some((c) => c)) emit('concepts', concepts)
  }
  const NOTE_FIELDS = ['text', 'kind', 'subjectId', 'conceptId', 'pinned', 'status'] as const
  const restoreNote = (before: Note) => {
    const now = repos.notes.get(before.id)
    if (!now) return
    const fields = pick(before, NOTE_FIELDS)
    if (changedKeys(now, fields).length > 0) repos.notes.update(before.id, fields)
    noteChanged(now, before)
  }

  // ── roadmaps ──
  const restoreRoadmaps = (before: Roadmap[]) => {
    repos.transaction(() => {
      for (const r of before) repos.roadmaps.save(r)
    })
    emit(
      'roadmaps',
      before.map((r) => r.id),
    )
  }
  const reindex = (roadmap: Roadmap): Roadmap => {
    roadmap.items = roadmap.items.map((item, idx) => ({ ...item, idx }))
    return roadmap
  }
  /** idx follows the order; a roadmap with open steps is not done, one without is. */
  const settleRoadmap = (roadmap: Roadmap): Roadmap => {
    reindex(roadmap)
    const open = roadmap.items.some((i) => i.status === 'todo' || i.status === 'current')
    if (open && roadmap.status === 'done') roadmap.status = 'paused'
    if (!open) roadmap.status = 'done'
    roadmap.updatedAt = nowIso()
    return roadmap
  }
  const saveRoadmaps = (after: Roadmap[], before: Roadmap[], result: unknown, line: string) => {
    repos.transaction(() => {
      for (const r of after) repos.roadmaps.save(r)
    })
    emit(
      'roadmaps',
      after.map((r) => r.id),
    )
    return wrote(result, line, () => restoreRoadmaps(before))
  }
  const stepLabel = (item: RoadmapItem) => `step ${item.idx + 1} ${q(item.title)}`

  // ── settings & profile ──
  const restoreSettings = (before: Partial<Settings>) => {
    const settings = repos.settings.update(before)
    bus.emit('settings:changed', { settings })
  }
  const restoreProfile = (before: Partial<Profile>) => {
    repos.profile.update(before)
    emit('profile', Object.keys(before))
  }

  const ops: Record<WriteKind, KindOps> = {
    subject: {
      refuse: {
        delete:
          'Subjects are deleted only by the student, on the subject page (it removes everything remembered about it). Tell them where to do it.',
      },
      create(data) {
        const d = validate(SubjectCreate, data, 'subject')
        const twin = repos.subjects.findByName(d.name)
        if (twin) return outcome({ alreadyExists: true, subject: { id: twin.id, name: twin.name } })
        const s = repos.subjects.create(d)
        subjectChanged(s.id)
        return wrote(
          { created: 'subject', id: s.id, name: s.name },
          `Created subject ${q(s.name)}`,
          () => {
            if (!repos.subjects.get(s.id)) return
            const used =
              repos.concepts.listBySubject(s.id).length > 0 ||
              repos.notes.list({ subjectId: s.id, limit: 1 }).length > 0 ||
              repos.roadmaps.listBySubject(s.id).length > 0
            // Studied since: archive it rather than lose what was learned.
            if (used) repos.subjects.update(s.id, { status: 'archived' })
            else repos.subjects.remove(s.id)
            subjectChanged(s.id)
          },
        )
      },
      update(id, patch) {
        const s = mustSubject(id)
        const p = validate(SubjectFields.partial(), patch, 'subject')
        if (p.name !== undefined) {
          const twin = repos.subjects.findByName(p.name)
          if (twin && twin.id !== s.id)
            throw new Refusal(`A subject ${q(twin.name)} already exists`)
        }
        const keys = changedKeys(s, p)
        if (keys.length === 0) return outcome({ unchanged: true, id: s.id })
        const before = { id: s.id, ...pick(s, keys) }
        const after = repos.subjects.update(s.id, pick(p, keys) as Partial<Subject>)
        subjectChanged(s.id)
        const parts: string[] = []
        if (keys.includes('goal')) parts.push(after.goal ? `goal ${q(after.goal)}` : 'goal cleared')
        if (keys.includes('deadline'))
          parts.push(after.deadline ? `deadline ${day(after.deadline)}` : 'deadline cleared')
        if (keys.includes('description')) parts.push(`covers ${q(after.description)}`)
        if (keys.includes('emoji')) parts.push(`emoji ${after.emoji}`)
        if (keys.includes('status')) parts.push(`status ${after.status}`)
        const renamed = keys.includes('name') ? `Renamed ${q(s.name)} → ${q(after.name)}` : null
        const saved = parts.length > 0 ? `Saved to ${after.name}: ${parts.join(', ')}` : null
        const line = [renamed, saved].filter(Boolean).join(' · ')
        return wrote({ updated: 'subject', id: s.id, ...pick(after, keys) }, line, () =>
          restoreSubject(before),
        )
      },
    },

    topic: {
      refuse: {},
      create(data) {
        const d = validate(TopicCreate, data, 'topic')
        const subject = mustSubject(d.subjectId)
        const twin = repos.concepts.findByName(subject.id, d.name)
        if (twin) return outcome({ alreadyExists: true, topic: { id: twin.id, name: twin.name } })
        const parent = d.parentId ? mustTopic(d.parentId) : null
        if (parent && parent.subjectId !== subject.id)
          throw new Refusal('parentId: that topic belongs to another subject')
        const made = repos.transaction(() => {
          const c = repos.concepts.upsert({ subjectId: subject.id, name: d.name })
          const patch: Partial<Concept> = {}
          if (parent) patch.parentId = parent.id
          if (d.summary) Object.assign(patch, { summary: d.summary, summaryPinned: true })
          return Object.keys(patch).length > 0 ? repos.concepts.update(c.id, patch) : c
        })
        emit('concepts', [made.id])
        emit('subjects', [subject.id])
        const under = parent ? ` under ${q(parent.name)}` : ''
        return wrote(
          { created: 'topic', id: made.id, name: made.name, subjectId: subject.id },
          `Added topic ${q(made.name)} to ${subject.name}${under}`,
          () => {
            if (!repos.concepts.get(made.id)) return
            repos.transaction(() => repos.concepts.remove(made.id))
            emit('subjects', [subject.id])
          },
        )
      },
      update(id, patch) {
        const c = mustTopic(id)
        const p = validate(TopicPatch, patch, 'topic')
        if (Object.values(p).every((v) => v === undefined)) throw nothingToChange(TopicPatch)
        const moving = p.subjectId !== undefined && p.subjectId !== c.subjectId
        const target = moving ? mustSubject(p.subjectId ?? null) : mustSubject(c.subjectId)
        const all = repos.concepts.listBySubject(c.subjectId)
        const subtree = [...subtreeIds(c.id, all)]
        if (moving && !relink)
          throw new Refusal('Moving a topic to another subject is not available here')
        if (moving)
          for (const m of all.filter((x) => subtree.includes(x.id))) {
            const twin = repos.concepts.findByName(target.id, m.name)
            if (twin) throw new Refusal(`${target.name} already has a topic ${q(twin.name)}`)
          }
        const name = p.name !== undefined && p.name !== c.name ? p.name : undefined
        if (name !== undefined) {
          const twin = repos.concepts.findByName(target.id, name)
          if (twin && twin.id !== c.id)
            throw new Refusal(`${q(twin.name)} already exists in ${target.name}`)
        }
        let parent: Concept | null | undefined
        if (p.parentId !== undefined && (moving || p.parentId !== c.parentId)) {
          parent = p.parentId ? mustTopic(p.parentId) : null
          if (parent && parent.subjectId !== target.id)
            throw new Refusal('parentId: that topic belongs to another subject')
          if (parent && subtree.includes(parent.id))
            throw new Refusal('parentId: a topic can not sit under itself or its own subtopics')
        }
        const summary = p.summary !== undefined && p.summary !== c.summary ? p.summary : undefined
        const status = p.status !== undefined && p.status !== c.status ? p.status : undefined
        if (!moving && [name, parent, summary, status].every((v) => v === undefined))
          return outcome({ unchanged: true, id: c.id })

        const snap = topicSnapshot(moving ? subtree : [c.id], moving)
        const after = repos.transaction(() => {
          if (moving && relink) {
            for (const m of snap.concepts) relink.moveConcept(m.id, target.id)
            // The subtree keeps its shape; its top lands where the patch says (else top level).
            for (const m of snap.concepts)
              repos.concepts.update(m.id, { parentId: m.id === c.id ? null : m.parentId })
            // Edges never cross subjects, so the move dropped them all; those inside the
            // subtree still hold.
            for (const e of snap.edges)
              if (subtree.includes(e.fromId) && subtree.includes(e.toId))
                repos.edges.add({ fromId: e.fromId, toId: e.toId, why: e.why, source: e.source })
          }
          const fields: Partial<Concept> = {}
          if (name !== undefined) fields.name = name
          // The student's own big picture: consolidation never rewrites it (memory-control).
          if (summary !== undefined) Object.assign(fields, { summary, summaryPinned: true })
          if (parent !== undefined) fields.parentId = parent?.id ?? null
          if (status !== undefined) fields.status = status
          return Object.keys(fields).length > 0
            ? repos.concepts.update(c.id, fields)
            : mustTopic(c.id)
        })
        emit('concepts', subtree)
        emit('subjects', [c.subjectId, target.id])
        const parts: string[] = []
        if (name !== undefined) parts.push(`Renamed ${q(c.name)} → ${q(name)}`)
        if (moving) {
          const subs = subtree.length - 1
          const withSubs = subs > 0 ? ` with ${plural(subs, 'subtopic')}` : ''
          parts.push(`Moved ${q(after.name)} to ${target.name}${withSubs}`)
        }
        if (parent !== undefined)
          parts.push(
            parent
              ? `Put ${q(after.name)} under ${q(parent.name)}`
              : `Made ${q(after.name)} a main topic`,
          )
        if (summary !== undefined) parts.push(`Big picture of ${q(after.name)} updated`)
        if (status !== undefined) parts.push(`Marked ${q(after.name)} as ${status}`)
        return wrote(
          {
            updated: 'topic',
            id: c.id,
            name: after.name,
            subjectId: after.subjectId,
            parentId: after.parentId,
            summary: summary === undefined ? undefined : after.summary,
            status: after.status,
            movedSubtopics: moving ? subtree.filter((x) => x !== c.id) : undefined,
          },
          parts.join(' · '),
          () => restoreTopics(snap),
        )
      },
      remove(id) {
        const c = mustTopic(id)
        const count = repos.notes.list({ conceptId: c.id }).length
        const notes = count > 0 ? ` and its ${plural(count, 'note')}` : ''
        const from = repos.subjects.get(c.subjectId)?.name
        return {
          question: `Delete the topic ${q(c.name)}${notes}${from ? ` from ${from}` : ''}? Say yes to delete it.`,
          run() {
            const snap = topicSnapshot([c.id], true)
            repos.transaction(() => repos.concepts.remove(c.id))
            emit('subjects', [c.subjectId])
            return wrote(
              { deleted: 'topic', id: c.id, name: c.name, notesDeleted: count },
              `Deleted topic ${q(c.name)}${notes}`,
              () => restoreTopics(snap),
            )
          },
        }
      },
    },

    note: {
      refuse: {},
      create(data) {
        const d = validate(NoteCreate, data, 'note')
        const concept = d.conceptId ? mustTopic(d.conceptId) : null
        const subjectId = d.subjectId ?? concept?.subjectId ?? null
        if (!subjectId)
          throw new Refusal('Say where the note goes: subjectId, and conceptId for a topic')
        const subject = mustSubject(subjectId)
        if (concept && concept.subjectId !== subject.id)
          throw new Refusal('conceptId: that topic belongs to another subject')
        const { note, created } = repos.notes.add({
          subjectId: subject.id,
          conceptId: concept?.id ?? null,
          encounterId: null,
          kind: d.kind ?? 'fact',
          text: d.text,
          source: CHAT_NOTE_SOURCE,
        })
        if (!created)
          return outcome({ alreadyExists: true, note: { id: note.id, text: note.text } })
        // The student's own words: consolidation never rewrites or merges it.
        const saved = repos.notes.update(note.id, { pinned: true })
        noteChanged(saved)
        return wrote(
          { created: 'note', id: saved.id, subjectId: saved.subjectId, conceptId: saved.conceptId },
          `Saved to ${placeName(saved.subjectId, saved.conceptId)}: ${q(saved.text, 80)}`,
          () => {
            if (repos.notes.get(saved.id)?.status !== 'active') return
            repos.notes.remove(saved.id)
            noteChanged(saved)
          },
        )
      },
      update(id, patch) {
        const n = mustNote(id)
        const p = validate(NotePatch, patch, 'note')
        if (Object.values(p).every((v) => v === undefined)) throw nothingToChange(NotePatch)
        const next: Partial<Note> = {}
        if (p.text !== undefined && p.text !== n.text) next.text = p.text
        if (p.kind !== undefined && p.kind !== n.kind) next.kind = p.kind
        if (p.subjectId !== undefined || p.conceptId !== undefined) {
          const concept = p.conceptId ? mustTopic(p.conceptId) : null
          let subjectId =
            p.subjectId === undefined ? (concept?.subjectId ?? n.subjectId) : p.subjectId
          if (subjectId) subjectId = mustSubject(subjectId).id
          if (concept && concept.subjectId !== subjectId)
            throw new Refusal('conceptId: that topic belongs to another subject')
          let conceptId = p.conceptId === undefined ? n.conceptId : p.conceptId
          // A note filed into another subject leaves its old topic.
          if (p.conceptId === undefined && subjectId !== n.subjectId) conceptId = null
          if (!subjectId) conceptId = null
          if (subjectId !== n.subjectId) next.subjectId = subjectId
          if (conceptId !== n.conceptId) next.conceptId = conceptId
        }
        const pinned = p.pinned ?? (next.text !== undefined ? true : undefined)
        if (pinned !== undefined && pinned !== n.pinned) next.pinned = pinned
        if (Object.keys(next).length === 0) return outcome({ unchanged: true, id: n.id })
        const after = repos.notes.update(n.id, next)
        noteChanged(n, after)
        const parts: string[] = []
        if (next.text !== undefined) parts.push(`Edited note ${q(after.text)}`)
        if (next.kind !== undefined) parts.push(`Note ${q(after.text)} is now a ${after.kind}`)
        if (next.subjectId !== undefined || next.conceptId !== undefined)
          parts.push(
            after.subjectId
              ? `Filed note ${q(after.text)} under ${placeName(after.subjectId, after.conceptId)}`
              : `Moved note ${q(after.text)} to loose notes`,
          )
        if (p.pinned !== undefined && next.pinned !== undefined)
          parts.push(`${after.pinned ? 'Pinned' : 'Unpinned'} note ${q(after.text)}`)
        return wrote(
          { ...pick(after, Object.keys(next) as (keyof Note)[]), updated: 'note', id: n.id },
          parts.join(' · '),
          () => restoreNote(n),
        )
      },
      remove(id) {
        const n = mustNote(id)
        const from =
          (n.conceptId ? repos.concepts.get(n.conceptId)?.name : null) ??
          (n.subjectId ? repos.subjects.get(n.subjectId)?.name : null)
        return {
          question: `Delete the note ${q(n.text)}${from ? ` from ${from}` : ''}? Say yes to delete it.`,
          run() {
            repos.notes.remove(n.id)
            noteChanged(n)
            return wrote({ deleted: 'note', id: n.id }, `Deleted note ${q(n.text)}`, () =>
              restoreNote(n),
            )
          },
        }
      },
    },

    roadmap: {
      refuse: {
        create:
          'Roadmaps are planned with act start_roadmap (a new one) or act adjust_roadmap (replan an existing one), not with create.',
        delete:
          'Roadmaps are never deleted. Pause it instead: update {"status":"paused"}, or replan it with act adjust_roadmap.',
      },
      update(id, patch) {
        const r = mustRoadmap(id)
        const p = validate(RoadmapPatch, patch, 'roadmap')
        if (Object.values(p).every((v) => v === undefined)) throw nothingToChange(RoadmapPatch)
        const keys = changedKeys(r, p)
        if (keys.length === 0) return outcome({ unchanged: true, id: r.id })
        const after: Roadmap = { ...structuredClone(r), ...pick(p, keys), updatedAt: nowIso() }
        // One active roadmap per subject: activating this one pauses the other.
        const others =
          p.status === 'active'
            ? repos.roadmaps
                .listBySubject(r.subjectId)
                .filter((x) => x.id !== r.id && x.status === 'active')
            : []
        const paused = others.map((x) => ({ ...x, status: 'paused' as const, updatedAt: nowIso() }))
        const parts: string[] = []
        if (keys.includes('title')) parts.push(`Renamed roadmap ${q(r.title)} → ${q(after.title)}`)
        if (keys.includes('goal')) parts.push(`Roadmap ${q(after.title)}: goal ${q(after.goal)}`)
        if (keys.includes('status')) {
          const verb = { active: 'Resumed', paused: 'Paused', done: 'Finished' }[after.status]
          parts.push(`${verb} roadmap ${q(after.title)}`)
          for (const x of others) parts.push(`paused ${q(x.title)}`)
        }
        return saveRoadmaps(
          [after, ...paused],
          [r, ...others],
          {
            updated: 'roadmap',
            id: r.id,
            ...pick(after, keys),
            paused: others.map((x) => x.id),
          },
          parts.join(' · '),
        )
      },
    },

    roadmap_step: {
      refuse: {},
      create(data) {
        const d = validate(StepCreate, data, 'roadmap_step')
        const r = mustRoadmap(d.roadmapId)
        const position = d.position ?? r.items.length + 1
        if (position > r.items.length + 1)
          throw new Refusal(`position: at most ${r.items.length + 1} for this roadmap`)
        const item: LearnItem = {
          kind: 'learn',
          id: newId('itm'),
          idx: position - 1,
          title: d.title,
          objective: d.objective,
          concepts: [],
          move: 'intuition',
          promptDraft: '',
          promptSent: null,
          status: 'todo',
        }
        const after = structuredClone(r)
        after.items.splice(position - 1, 0, item)
        settleRoadmap(after)
        return saveRoadmaps(
          [after],
          [r],
          { created: 'roadmap_step', id: item.id, roadmapId: r.id, position },
          `Added step ${position} ${q(item.title)} to ${q(r.title)}`,
        )
      },
      update(id, patch) {
        const { roadmap: r, index } = findStep(id)
        const p = validate(StepPatch, patch, 'roadmap_step')
        if (Object.values(p).every((v) => v === undefined)) throw nothingToChange(StepPatch)
        let after = reindex(structuredClone(r))
        const original = after.items[index] as RoadmapItem
        const label = stepLabel(original)
        const parts: string[] = []
        const item = () => after.items.find((i) => i.id === original.id) as RoadmapItem
        if (p.title !== undefined && p.title !== original.title) {
          item().title = p.title
          parts.push(`Renamed ${label} → ${q(p.title)}`)
        }
        if (p.objective !== undefined) {
          const it = item()
          if (it.kind !== 'learn')
            throw new Refusal('objective: a checkpoint has no objective, only a title')
          if (p.objective !== it.objective) {
            it.objective = p.objective
            parts.push(`Step ${it.idx + 1} ${q(it.title)}: objective updated`)
          }
        }
        if (p.status !== undefined && p.status !== original.status) {
          const it = item()
          if ((p.status === 'done' || p.status === 'skipped') && it.status === 'current') {
            // Closed like the session closes it: the next open step becomes current.
            after = closeItem(after, it.idx, nowIso(), p.status)
          } else {
            if (p.status === 'current')
              for (const other of after.items) if (other.status === 'current') other.status = 'todo'
            it.status = p.status
          }
          const words = {
            done: `Marked step ${it.idx + 1} ${q(it.title)} done`,
            skipped: `Skipped step ${it.idx + 1} ${q(it.title)}`,
            current: `Step ${it.idx + 1} ${q(it.title)} is now the current step`,
            todo: `Reopened step ${it.idx + 1} ${q(it.title)}`,
          }
          parts.push(words[p.status])
        }
        if (p.position !== undefined && p.position !== original.idx + 1) {
          if (p.position > after.items.length)
            throw new Refusal(`position: at most ${after.items.length} for this roadmap`)
          const from = after.items.findIndex((i) => i.id === original.id)
          const [moved] = after.items.splice(from, 1)
          if (moved) after.items.splice(p.position - 1, 0, moved)
          parts.push(`Moved ${label} to position ${p.position}`)
        }
        if (parts.length === 0) return outcome({ unchanged: true, id: original.id })
        settleRoadmap(after)
        if (r.status !== 'done' && after.status === 'done')
          parts.push(`roadmap ${q(after.title)} finished`)
        const now = item()
        const current = after.items.find((i) => i.status === 'current')
        return saveRoadmaps(
          [after],
          [r],
          {
            updated: 'roadmap_step',
            id: now.id,
            roadmapId: r.id,
            position: now.idx + 1,
            title: now.title,
            status: now.status,
            currentStep: current ? current.idx + 1 : null,
            roadmapStatus: after.status,
          },
          parts.join(' · '),
        )
      },
      remove(id) {
        const { roadmap: r, index } = findStep(id)
        const original = r.items[index] as RoadmapItem
        const label = stepLabel({ ...original, idx: index })
        return {
          question: `Delete ${label} from the plan ${q(r.title)}? Say yes to delete it.`,
          run() {
            const after = structuredClone(r)
            after.items.splice(index, 1)
            if (original.status === 'current') {
              const next = after.items.find(
                (i, at) => at >= index && (i.status === 'todo' || i.status === 'current'),
              )
              if (next) next.status = 'current'
            }
            settleRoadmap(after)
            return saveRoadmaps(
              [after],
              [r],
              { deleted: 'roadmap_step', id: original.id, roadmapId: r.id },
              `Deleted ${label}`,
            )
          },
        }
      },
    },

    feedback: {
      refuse: {
        update: 'Feedback is not edited: delete it and create the new wording.',
      },
      create(data) {
        const d = validate(FeedbackCreate, data, 'feedback')
        const subjectId = d.subjectId ? mustSubject(d.subjectId).id : null
        const f = repos.feedback.add({ text: d.text, scope: d.scope ?? 'general', subjectId })
        return wrote(
          { created: 'feedback', id: f.id, scope: f.scope },
          `Saved feedback: ${q(f.text, 80)}`,
          () => repos.feedback.remove(f.id),
        )
      },
      remove(id) {
        const f = repos.feedback.recent({ limit: 1000 }).find((x) => x.id === id)
        if (!f) throw missing('feedback', id)
        return {
          question: `Delete your feedback ${q(f.text)}? Say yes to delete it.`,
          run() {
            repos.feedback.remove(f.id)
            // Comes back under a new id (FeedbackRepo has no restore); same text, scope, subject.
            return wrote({ deleted: 'feedback', id: f.id }, `Deleted feedback ${q(f.text)}`, () => {
              repos.feedback.add({ text: f.text, scope: f.scope, subjectId: f.subjectId })
            })
          },
        }
      },
    },

    assignment: {
      refuse: {
        delete: 'Assignments are not deleted: update its status to "dismissed" (or "done").',
      },
      create(data) {
        const d = validate(AssignmentCreate, data, 'assignment')
        const subjectId = d.subjectId ? mustSubject(d.subjectId).id : null
        const known = new Set(repos.assignments.list({}).map((a) => a.id))
        const made = repos.assignments.upsert({
          subjectId,
          title: d.title,
          dueAt: d.dueAt ?? null,
          source: 'Dumbledore chat',
        })
        if (known.has(made.id))
          return outcome({ alreadyExists: true, assignment: { id: made.id, title: made.title } })
        const a =
          d.status && d.status !== made.status
            ? repos.assignments.update(made.id, { status: d.status })
            : made
        emit('assignments', [a.id])
        const due = a.dueAt ? ` (due ${day(a.dueAt)})` : ''
        return wrote(
          { created: 'assignment', id: a.id, title: a.title, dueAt: a.dueAt },
          `Added assignment ${q(a.title)}${due}`,
          () => {
            // AssignmentRepo has no delete: dismissed is how an assignment leaves every list.
            repos.assignments.update(a.id, { status: 'dismissed' })
            emit('assignments', [a.id])
          },
        )
      },
      update(id, patch) {
        const a = mustAssignment(id)
        const p = validate(AssignmentFields.partial(), patch, 'assignment')
        if (Object.values(p).every((v) => v === undefined)) throw nothingToChange(AssignmentFields)
        if (p.subjectId) mustSubject(p.subjectId)
        const keys = changedKeys(a, p)
        if (keys.length === 0) return outcome({ unchanged: true, id: a.id })
        const before = pick(a, keys)
        const after = repos.assignments.update(a.id, pick(p, keys) as Partial<Assignment>)
        emit('assignments', [a.id])
        const parts: string[] = []
        if (keys.includes('title')) parts.push(`renamed ${q(after.title)}`)
        if (keys.includes('dueAt'))
          parts.push(after.dueAt ? `due ${day(after.dueAt)}` : 'no due date')
        if (keys.includes('status')) parts.push(`marked ${after.status}`)
        if (keys.includes('subjectId'))
          parts.push(
            after.subjectId ? `moved to ${placeName(after.subjectId, null)}` : 'no subject',
          )
        return wrote(
          { updated: 'assignment', id: a.id, ...pick(after, keys) },
          `Assignment ${q(a.title)}: ${parts.join(', ')}`,
          () => {
            repos.assignments.update(a.id, before)
            emit('assignments', [a.id])
          },
        )
      },
    },

    settings: {
      refuse: {
        create: 'Settings are only updated.',
        delete: 'Settings are only updated.',
      },
      update(_id, patch) {
        const p = validate(
          SettingsPatch,
          patch,
          'settings',
          '. AI, keys, providers and capture are changed only by the student, in Settings.',
        )
        if (p.focusSubjectId) mustSubject(p.focusSubjectId)
        const topic = p.focusTopicId ? mustTopic(p.focusTopicId) : null
        const current = repos.settings.get()
        const keys = changedKeys(current, p)
        if (keys.length === 0) {
          if (Object.keys(p).length === 0) throw nothingToChange(SettingsPatch)
          return outcome({ unchanged: true })
        }
        const before = pick(current, keys)
        const settings = repos.settings.update(pick(p, keys))
        bus.emit('settings:changed', { settings })
        const parts: string[] = []
        if (keys.includes('focusSubjectId'))
          parts.push(
            settings.focusSubjectId
              ? `Focus set to ${placeName(settings.focusSubjectId, null)}`
              : 'Focus cleared',
          )
        if (keys.includes('focusTopicId'))
          parts.push(topic ? `Topic locked to ${q(topic.name)}` : 'Topic unlocked')
        if (keys.includes('theme')) parts.push(`Theme: ${settings.theme}`)
        if (keys.includes('timerMinutes')) parts.push(`Timer set to ${settings.timerMinutes} min`)
        return wrote({ updated: 'settings', ...pick(settings, keys) }, parts.join(' · '), () =>
          restoreSettings(before),
        )
      },
    },

    profile: {
      refuse: {
        create: 'The profile is only updated.',
        delete: 'The profile is only updated.',
      },
      update(_id, patch) {
        const p = validate(ProfilePatch, patch, 'profile')
        const current = repos.profile.get()
        const keys = changedKeys(current, p)
        if (keys.length === 0) {
          if (Object.keys(p).length === 0) throw nothingToChange(ProfilePatch)
          return outcome({ unchanged: true })
        }
        const before = pick(current, keys)
        const after = repos.profile.update(pick(p, keys))
        emit('profile', keys)
        const parts: string[] = []
        if (keys.includes('aboutMe')) parts.push('About you updated')
        if (keys.includes('level'))
          parts.push(after.level ? `Level set to ${q(after.level)}` : 'Level cleared')
        if (keys.includes('promptLanguage'))
          parts.push(`Prompt language: ${LANGUAGES[after.promptLanguage]}`)
        return wrote({ updated: 'profile', ...pick(after, keys) }, parts.join(' · '), () =>
          restoreProfile(before),
        )
      },
    },
  }

  const guarded = (run: () => ToolOutcome): ToolOutcome => {
    try {
      return run()
    } catch (error) {
      if (error instanceof Refusal) return failure(error.message)
      return failure(error instanceof Error ? error.message : String(error))
    }
  }
  const refused = (kind: WriteKind, op: 'create' | 'update' | 'delete') =>
    failure(ops[kind].refuse[op] ?? `${kind} can't be ${op}d with this tool`)

  const Kind = z.enum(WRITE_KINDS)

  return [
    defineTool({
      name: 'create',
      description: [
        'Create a record in the student’s Dumbledore data. Acts at once; the student gets a receipt with Undo.',
        'kind and data fields (data is a JSON object string; ids come from read/search):',
        '- subject: name, emoji?, description?, goal?, deadline? (YYYY-MM-DD), status? (active|suggested|archived)',
        '- topic: subjectId, name, parentId?, summary? (the big picture)',
        '- note: subjectId and/or conceptId (a topic id), text (≤200 chars, one fact), kind? (fact|definition|formula|example|highlight|question|misconception)',
        '- roadmap_step: roadmapId, title, objective, position? (1 = first; default last)',
        '- feedback: text (feedback about Dumbledore itself), scope? (study_plan|quizzes|prompts|memory|general), subjectId?',
        '- assignment: title, dueAt? (YYYY-MM-DD), status? (open|done|dismissed), subjectId?',
        'Roadmaps are not created here: use act start_roadmap or adjust_roadmap.',
      ].join('\n'),
      input: z.object({
        kind: Kind,
        data: jsonField('{"subjectId":"sub_…","name":"Bayes’ theorem"}'),
      }),
      run({ kind, data }) {
        const op = ops[kind].create
        if (!op) return refused(kind, 'create')
        return guarded(() => op(parseObject(data, 'data')))
      },
    }),
    defineTool({
      name: 'update',
      description: [
        'Change a record: only the fields in patch change. Acts at once; the student gets a receipt with Undo.',
        'kind, id and patch fields (patch is a JSON object string):',
        '- subject: name, emoji, description, goal, deadline (YYYY-MM-DD or null), status',
        '- topic: name (rename), summary (its big picture), parentId (null = main topic), subjectId (move it, with its subtopics, to another subject), status (new|learning|struggling|mastered)',
        '- note: text, kind, subjectId + conceptId (file it), pinned',
        '- roadmap: title, goal, status (active|paused|done; activating one pauses the subject’s other active roadmap)',
        '- roadmap_step (id = the step’s item id): title, objective, status (todo|current|done|skipped), position (1 = first)',
        '- assignment: title, dueAt, status (open|done|dismissed), subjectId',
        '- settings (id null): focusSubjectId, focusTopicId, theme (system|light|dark), timerMinutes (1–180)',
        '- profile (id null): aboutMe, level, promptLanguage (auto|en|fi|sv)',
      ].join('\n'),
      input: z.object({
        kind: Kind,
        id: Id.nullable().describe(
          'The record’s id from read or search; null for settings and profile',
        ),
        patch: jsonField('{"name":"Conditional probability"}'),
      }),
      run({ kind, id, patch }) {
        const op = ops[kind].update
        if (!op) return refused(kind, 'update')
        return guarded(() => op(id, parseObject(patch, 'patch')))
      },
    }),
    defineTool({
      name: 'delete',
      description: [
        'Delete a record: topic (its notes go too), note, roadmap_step or feedback.',
        'Asks first: with confirmed false nothing is deleted and the result has the question to ask the student, word for word. Ask it as your whole reply.',
        'Only when their next message says yes, call delete again with the same kind and id and confirmed true. Never pass confirmed true before you asked.',
        'Subjects are deleted only by the student on the subject page; roadmaps are never deleted (pause them); assignments are dismissed with update.',
      ].join('\n'),
      input: z.object({
        kind: Kind,
        id: Id.describe('The record’s id from read or search'),
        confirmed: z
          .boolean()
          .describe('true only after you asked and the student’s message said yes'),
      }),
      run({ kind, id, confirmed }, ctx) {
        const op = ops[kind].remove
        if (!op) return refused(kind, 'delete')
        return guarded(() => {
          const deletion = op(id)
          const key = `${kind}:${id}`
          const at = asked.get(key)
          const now = Date.parse(nowIso())
          const pending = at !== undefined && now - at <= CONFIRM_MS
          if (confirmed && pending && saysYes(ctx.message)) {
            asked.delete(key)
            return deletion.run()
          }
          asked.set(key, now)
          return outcome({
            deleted: false,
            needsConfirmation: true,
            ask: deletion.question,
            note:
              confirmed && pending
                ? 'Nothing was deleted: the student’s message is not a yes. Ask again, or leave it.'
                : 'Nothing was deleted yet. Ask exactly this question as your reply; delete with confirmed true after they say yes.',
          })
        })
      },
    }),
  ] as ChatTool[]
}
