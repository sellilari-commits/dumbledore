/**
 * Exam generation (P6). Picks concepts for the spec's focus (weak spots / due / everything),
 * plans one slot per question interleaved across subjects, asks the exam builder in batches of
 * ≤ 5 questions (Groq's free tier allows ~8K tokens a minute), verifies every batch blind and
 * regenerates mismatches. Ends with a difficulty ramp. QuizService runs this in the background.
 */
import type { Brain, ExamInput, QuestionDraft } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { Concept, ExamSpec, Question, Subject } from '@shared/domain'
import {
  chunk,
  conceptFinder,
  distinctBy,
  type Log,
  sanitizeDrafts,
  studiedDigest,
  toQuestion,
} from './drafts'
import { verifyWithRetries } from './verify'

export const EXAM_BATCH = 5
/** Below this mastery a concept counts as a weak spot. */
export const WEAK_MASTERY = 0.5
const CALL_TIMEOUT_MS = 60_000

const strugglingFirst = (c: Concept): number => (c.status === 'struggling' ? 0 : 1)

/** Round-robin across subjects, keeping each subject's own order. */
export function interleaveBySubject(concepts: readonly Concept[]): Concept[] {
  const lanes = new Map<string, Concept[]>()
  for (const c of concepts) lanes.set(c.subjectId, [...(lanes.get(c.subjectId) ?? []), c])
  const out: Concept[] = []
  for (let i = 0; out.length < concepts.length; i++) {
    for (const lane of lanes.values()) {
      const c = lane[i]
      if (c) out.push(c)
    }
  }
  return out
}

export function selectExamConcepts(
  concepts: readonly Concept[],
  focus: ExamSpec['focus'],
  nowIso: string,
): Concept[] {
  const byWeakness = (a: Concept, b: Concept) =>
    strugglingFirst(a) - strugglingFirst(b) ||
    b.struggleCount - a.struggleCount ||
    a.mastery - b.mastery
  let picked: Concept[]
  if (focus === 'weak') {
    picked = concepts
      .filter((c) => c.status === 'struggling' || c.mastery < WEAK_MASTERY || c.struggleCount > 0)
      .sort(byWeakness)
  } else if (focus === 'due') {
    picked = concepts
      .filter((c) => c.nextReviewAt !== null && c.nextReviewAt <= nowIso)
      .sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''))
  } else {
    picked = [...concepts].sort(byWeakness)
  }
  if (picked.length === 0) picked = [...concepts].sort(byWeakness)
  return interleaveBySubject(picked)
}

/** `count` slots filled round-robin from `items` (empty when there are no items). */
export function planSlots<T>(items: readonly T[], count: number): T[] {
  if (items.length === 0) return []
  return Array.from({ length: count }, (_, i) => items[i % items.length] as T)
}

export interface ExamGenDeps {
  repos: Repos
  brain: Brain
  log: Log
  language: string
  nowIso: string
}

export interface ExamGenResult {
  questions: Question[]
  dropped: number
  regenerated: number
  failedBatches: number
}

export async function generateExamQuestions(
  deps: ExamGenDeps,
  spec: ExamSpec,
): Promise<ExamGenResult> {
  const { repos, brain, log, language } = deps
  const subjects = spec.subjectIds
    .map((id) => repos.subjects.get(id))
    .filter((s): s is Subject => s !== null)
  if (subjects.length === 0) throw new Error('exam has no known subjects')
  const subjectIds = subjects.map((s) => s.id)
  const all = subjects.flatMap((s) => repos.concepts.listBySubject(s.id))
  const selected = selectExamConcepts(all, spec.focus, deps.nowIso).slice(0, spec.count)
  const slots = planSlots(selected, spec.count)
  const batches: Concept[][] =
    slots.length > 0
      ? chunk(slots, EXAM_BATCH)
      : Array.from({ length: Math.ceil(spec.count / EXAM_BATCH) }, () => [])
  const encounters = subjects
    .flatMap((s) => repos.encounters.list({ subjectId: s.id, limit: 4 }))
    .filter((e) => e.inboxState !== 'ignored')
    .slice(0, 8)
    .map((e) => ({ seen: e.seen.slice(0, 240), bigPicture: e.bigPicture.slice(0, 160) }))
  const studied = studiedDigest(repos, subjectIds)
  const find = conceptFinder(repos, subjectIds, selected)
  const subjectRefs = subjects.map((s) => ({ id: s.id, name: s.name, goal: s.goal }))

  const regenerate = (failed: QuestionDraft[]) => {
    const names = [...new Set(failed.map((q) => q.concept).filter(Boolean))]
    return brain.makeCheckpoint(
      {
        concepts: names.length > 0 ? names : subjects.map((s) => s.name),
        probes: [],
        carry: [],
        n: Math.min(5, failed.length),
        studied,
        language,
      },
      { timeoutMs: CALL_TIMEOUT_MS },
    )
  }

  const result: ExamGenResult = { questions: [], dropped: 0, regenerated: 0, failedBatches: 0 }
  for (const batch of batches) {
    const want = batch.length || EXAM_BATCH
    const input: ExamInput = {
      subjects: subjectRefs,
      spec: { ...spec, count: 5 },
      concepts: distinctBy(batch, (c) => c.id).map((c) => ({
        name: c.name,
        status: c.status,
        mastery: c.mastery,
      })),
      encounters,
      language,
    }
    let drafts: QuestionDraft[]
    try {
      const raw = await brain.makeExam(input, { timeoutMs: CALL_TIMEOUT_MS })
      const taken = result.questions.map((q) => q.stem)
      drafts = sanitizeDrafts(raw, taken).slice(0, want)
    } catch (error) {
      result.failedBatches++
      log('exam batch failed', error)
      continue
    }
    const outcome = await verifyWithRetries({ brain, drafts, regenerate, log })
    result.dropped += outcome.dropped
    result.regenerated += outcome.regenerated
    for (const d of outcome.questions)
      result.questions.push(toQuestion(d, find(d.concept)?.id ?? null))
  }
  result.questions.sort((a, b) => a.difficulty - b.difficulty) // stable: a gentle difficulty ramp
  return result
}

const FOCUS_LABEL: Record<ExamSpec['focus'], string> = {
  weak: 'weak spots',
  due: 'due reviews',
  everything: 'everything',
}

export function examTitle(subjects: readonly Subject[], spec: ExamSpec): string {
  const names = subjects.map((s) => s.name)
  const label =
    names.length > 2 ? `${names.slice(0, 2).join(' + ')} +${names.length - 2}` : names.join(' + ')
  return `${label} · ${FOCUS_LABEL[spec.focus]} · ${spec.count} questions`
}
