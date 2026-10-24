/**
 * Context assembly for the roadmapper (P3, PLAN R32): everything memory knows about a subject —
 * profile, mastery table with evidence, newest encounters, open questions, done steps and carried
 * misses of earlier roadmaps, the deadline — packed into a RoadmapInput. Since notes phase 2 it
 * also carries the subject's structure (docs/NOTES.md §6): the concept tree, prerequisite edges,
 * key notes, and the study order computed here, which the roadmap must follow.
 */
import type { Concept, Note, Quiz, Subject } from '@shared/domain'
import type { RoadmapInput } from '../../brain-contract'
import type { Repos, StudyPreferences } from '../../contracts'
import { studyOrder } from '../consolidate/order'
import { withDescendants } from './preferences'
import { isLearn } from './roadmap-ops'
import { head, languageOf, norm, profileText, uniqueNames } from './text'

export const ENCOUNTER_LIMIT = 20
const MASTERY_LIMIT = 40
const QUESTION_LIMIT = 10
const DONE_STEP_LIMIT = 30
const CARRY_LIMIT = 5
const TREE_LIMIT = 40
const ORDER_LIMIT = 25
const KEY_NOTES_PER_CONCEPT = 3
const KEY_NOTE_CHARS = 200

export interface RoadmapContext {
  input: RoadmapInput
  /** Concepts carried in from earlier roadmaps (start value of the new roadmap's carry). */
  carry: string[]
  /** Nothing known about the student and this subject yet → offer the placement check. */
  noHistory: boolean
}

export interface ContextRequest {
  subject: Subject
  goal: string
  assistant: string
  /** A question the student picked; it leads the open-question list. */
  question: string | null
  nowIso: string
}

export function assembleRoadmapContext(repos: Repos, req: ContextRequest): RoadmapContext {
  const { subject } = req
  const profile = repos.profile.get()
  const concepts = repos.concepts.listBySubject(subject.id)
  const quizEvidence = tallyQuizzes(repos.quizzes.list({ subjectId: subject.id, limit: 30 }))
  const encounters = repos.encounters
    .list({ subjectId: subject.id, limit: ENCOUNTER_LIMIT * 2 })
    .filter((e) => e.inboxState !== 'ignored')
    .slice(0, ENCOUNTER_LIMIT)
  const previous = repos.roadmaps.listBySubject(subject.id)
  const mastered = new Set(concepts.filter((c) => c.status === 'mastered').map((c) => norm(c.name)))
  const carry = uniqueNames(previous.flatMap((r) => r.carry))
    .filter((c) => !mastered.has(norm(c)))
    .slice(0, CARRY_LIMIT)
  const doneSteps = previous
    .flatMap((r) => r.items.filter((i) => isLearn(i) && i.status === 'done').map((i) => i.title))
    .slice(0, DONE_STEP_LIMIT)
  const openQuestions = uniqueNames([
    ...(req.question ? [req.question] : []),
    ...repos.encounters.openQuestions(subject.id, QUESTION_LIMIT),
  ]).slice(0, QUESTION_LIMIT)

  const mastery = [...concepts]
    .sort(
      (a, b) =>
        (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name),
    )
    .slice(0, MASTERY_LIMIT)
    .map((c) => ({
      concept: c.name,
      status: c.status,
      evidence: evidenceFor(c, quizEvidence.get(norm(c.name)), req.nowIso),
    }))

  const noHistory =
    concepts.length === 0 &&
    encounters.length === 0 &&
    previous.length === 0 &&
    quizEvidence.size === 0

  return {
    carry,
    noHistory,
    input: {
      goal: req.goal,
      subject: { id: subject.id, name: subject.name },
      deadline: deadlineFor(repos, subject, req.nowIso),
      minutesAvailable: null,
      assistant: req.assistant,
      language: languageOf(profile),
      profile: profileText(profile),
      mastery,
      encounters: encounters.map((e) => ({
        seen: head(e.seen, 300),
        bigPicture: head(e.bigPicture, 200),
        understanding: e.understanding,
      })),
      openQuestions,
      doneSteps,
      carry,
      ...roadmapStructure(repos, subject.id, concepts),
    },
  }
}

type Structure = Pick<
  RoadmapInput,
  'tree' | 'edges' | 'keyNotes' | 'suggestedOrder' | 'preferences'
>

/**
 * The subject's structure for P3: the study order (prerequisites first, mastered skipped), the
 * tree around it (≤ 40 concepts, the ordered ones and their ancestors first), the edges between
 * them, and up to 3 key notes per concept (highlights and the student's own edits first).
 * The student's study preferences (adjust_roadmap) shape the order: skipped concepts and what
 * sits under them leave it, focus concepts and their prerequisites lead it.
 */
export function roadmapStructure(
  repos: Repos,
  subjectId: string,
  concepts: readonly Concept[],
): Structure {
  const prefs = repos.subjects.studyPreferences(subjectId)
  const preferences = prefs ? preferenceNames(prefs, concepts) : undefined
  if (concepts.length === 0) return preferences ? { preferences } : {}
  const notes = repos.notes.list({ subjectId })
  const noteCounts = new Map<string, number>()
  for (const n of notes)
    if (n.conceptId) noteCounts.set(n.conceptId, (noteCounts.get(n.conceptId) ?? 0) + 1)
  const edges = repos.edges.list(subjectId)
  const order = studyOrder({
    concepts,
    edges,
    noteCounts,
    exclude: prefs ? withDescendants(prefs.skip, concepts) : undefined,
    emphasise: prefs ? withDescendants(prefs.focus, concepts) : undefined,
  }).slice(0, ORDER_LIMIT)

  const byId = new Map(concepts.map((c) => [c.id, c]))
  const keep = new Set<string>()
  const add = (c: Concept) => {
    const chain: string[] = []
    for (let x: Concept | undefined = c; x && !keep.has(x.id); x = byId.get(x.parentId ?? ''))
      chain.push(x.id)
    if (keep.size + chain.length <= TREE_LIMIT) for (const id of chain) keep.add(id)
  }
  for (const c of order) add(c)
  for (const c of [...concepts].sort((a, b) =>
    (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? ''),
  ))
    add(c)
  const tree = concepts.filter((c) => keep.has(c.id))

  const rankNote = (n: Note) => (n.kind === 'highlight' ? 0 : n.pinned ? 1 : 2)
  const keyNotes = tree.flatMap((c) =>
    notes
      .filter((n) => n.conceptId === c.id && n.kind !== 'question')
      .sort((a, b) => rankNote(a) - rankNote(b) || b.updatedAt.localeCompare(a.updatedAt))
      .slice(0, KEY_NOTES_PER_CONCEPT)
      .map((n) => ({ conceptId: c.id, text: head(n.text, KEY_NOTE_CHARS) })),
  )
  return {
    tree: tree.map((c) => ({
      id: c.id,
      name: c.name,
      parentId: c.parentId && keep.has(c.parentId) ? c.parentId : null,
      status: c.status,
      mastery: c.mastery,
      summary: head(c.summary, 240),
    })),
    edges: edges
      .filter((e) => keep.has(e.fromId) && keep.has(e.toId))
      .map((e) => ({ fromId: e.fromId, toId: e.toId })),
    keyNotes,
    suggestedOrder: order.map((c) => c.name),
    ...(preferences ? { preferences } : {}),
  }
}

/** The stored wishes as names for P3: matched concepts plus the wishes that matched none. */
function preferenceNames(
  prefs: StudyPreferences,
  concepts: readonly Concept[],
): NonNullable<RoadmapInput['preferences']> {
  const name = new Map(concepts.map((c) => [c.id, c.name]))
  const names = (ids: string[], extra: string[]) =>
    uniqueNames([...ids.flatMap((id) => name.get(id) ?? []), ...extra])
  return {
    instruction: prefs.instruction,
    focus: names(prefs.focus, prefs.focusNames),
    skip: names(prefs.skip, prefs.skipNames),
  }
}

interface Tally {
  correct: number
  total: number
}

/** Answers per concept across the subject's quizzes (checkpoints, exams, reviews). */
function tallyQuizzes(quizzes: Quiz[]): Map<string, Tally> {
  const tally = new Map<string, Tally>()
  for (const quiz of quizzes) {
    for (const answer of quiz.answers) {
      const question = quiz.questions.find((q) => q.id === answer.questionId)
      if (!question) continue
      const key = norm(question.conceptName)
      const t = tally.get(key) ?? { correct: 0, total: 0 }
      t.total++
      if (answer.correct) t.correct++
      tally.set(key, t)
    }
  }
  return tally
}

function evidenceFor(concept: Concept, quiz: Tally | undefined, nowIso: string): string {
  const parts = [`mastery ${concept.mastery.toFixed(2)}`]
  if (quiz) parts.push(`quizzes ${quiz.correct}/${quiz.total} correct`)
  if (concept.struggleCount > 0) parts.push(`struggled ${concept.struggleCount}×`)
  if (concept.box > 0) parts.push(`review box ${concept.box}`)
  if (concept.nextReviewAt && concept.nextReviewAt <= nowIso) parts.push('review due')
  if (concept.lastSeenAt) parts.push(`last seen ${concept.lastSeenAt.slice(0, 10)}`)
  return parts.join(' · ')
}

/** The subject's own deadline, else its nearest open assignment that is not past. */
function deadlineFor(repos: Repos, subject: Subject, nowIso: string): string | null {
  if (subject.deadline) return subject.deadline
  const next = repos.assignments
    .list({ status: 'open', subjectId: subject.id })
    .find((a) => a.dueAt !== null && a.dueAt >= nowIso.slice(0, 10))
  return next?.dueAt ?? null
}
