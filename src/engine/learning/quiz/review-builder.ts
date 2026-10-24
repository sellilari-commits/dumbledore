/**
 * Review quizzes (F8 follow-ups): a short quiz over due concepts — at most 8 concepts, one
 * question each and at least 3 questions in total — written by the checkpoint quizmaster in
 * batches of ≤ 5, verified blind, and backed by a question bank of earlier quizzes when the LLM
 * is unavailable. Struggling concepts go in as `carry` so they get fresh scenarios.
 */
import type { Brain, QuestionDraft } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import { newId } from '@engine/ids'
import type { Concept, Id, Question } from '@shared/domain'
import {
  chunk,
  distinctBy,
  type Log,
  normalize,
  sanitizeDrafts,
  studiedDigest,
  toQuestion,
} from './drafts'
import { planSlots } from './exam-builder'
import { verifyWithRetries } from './verify'

export const REVIEW_MAX_CONCEPTS = 8
export const REVIEW_MIN_QUESTIONS = 3
const BATCH = 5
const CALL_TIMEOUT_MS = 45_000

/** The concepts to review: the given ones, else due ones, else struggling ones (≤ 8). */
export function pickReviewConcepts(
  repos: Repos,
  conceptIds: readonly Id[],
  nowIso: string,
): Concept[] {
  const given = [...new Set(conceptIds)]
    .map((id) => repos.concepts.get(id))
    .filter((c): c is Concept => c !== null)
  if (given.length > 0) return given.slice(0, REVIEW_MAX_CONCEPTS)
  const live = (c: Concept) => repos.subjects.get(c.subjectId)?.status !== 'archived'
  const due = repos.concepts.listDue(nowIso, 50).filter(live)
  if (due.length > 0) return due.slice(0, REVIEW_MAX_CONCEPTS)
  return repos.concepts.listStruggling(50).filter(live).slice(0, REVIEW_MAX_CONCEPTS)
}

export function reviewSlots(concepts: readonly Concept[]): Concept[] {
  const count = Math.min(REVIEW_MAX_CONCEPTS, Math.max(REVIEW_MIN_QUESTIONS, concepts.length))
  return planSlots(concepts.slice(0, REVIEW_MAX_CONCEPTS), count)
}

/** The latest earlier question on a concept, as a fresh copy that points back at its source. */
export function bankQuestion(
  repos: Repos,
  conceptId: Id,
  avoidStems: ReadonlySet<string>,
): Question | null {
  for (const quiz of repos.quizzes.list({ limit: 200 })) {
    for (const q of quiz.questions) {
      if (q.conceptId !== conceptId || avoidStems.has(normalize(q.stem))) continue
      return { ...q, id: newId('qst'), carriedFrom: q.id }
    }
  }
  return null
}

export interface ReviewGenDeps {
  repos: Repos
  brain: Brain
  log: Log
  language: string
}

export async function generateReviewQuestions(
  deps: ReviewGenDeps,
  concepts: readonly Concept[],
): Promise<{ questions: Question[]; fromBank: number }> {
  const { repos, brain, log, language } = deps
  const studied = studiedDigest(repos, [...new Set(concepts.map((c) => c.subjectId))])
  const questions: Question[] = []
  const write = (names: string[], carry: string[], n: number) =>
    brain.makeCheckpoint(
      { concepts: names, probes: [], carry, n, studied, language },
      { timeoutMs: CALL_TIMEOUT_MS },
    )

  for (const batch of chunk(reviewSlots(concepts), BATCH)) {
    const names = distinctBy(batch, (c) => c.id).map((c) => c.name)
    const carry = distinctBy(
      batch.filter((c) => c.status === 'struggling'),
      (c) => c.id,
    ).map((c) => c.name)
    try {
      const taken = questions.map((q) => q.stem)
      const drafts = sanitizeDrafts(await write(names, carry, batch.length), taken).slice(
        0,
        batch.length,
      )
      const outcome = await verifyWithRetries({
        brain,
        drafts,
        log,
        regenerate: (failed: QuestionDraft[]) =>
          write(
            [...new Set(failed.map((q) => q.concept).filter(Boolean))],
            [],
            Math.min(5, failed.length),
          ),
      })
      questions.push(...assign(outcome.questions, batch))
    } catch (error) {
      log('review batch failed; using the question bank', error)
    }
  }

  let fromBank = 0
  const stems = new Set(questions.map((q) => normalize(q.stem)))
  for (const concept of concepts.slice(0, REVIEW_MAX_CONCEPTS)) {
    if (questions.some((q) => q.conceptId === concept.id)) continue
    const banked = bankQuestion(repos, concept.id, stems)
    if (!banked) continue
    stems.add(normalize(banked.stem))
    questions.push(banked)
    fromBank++
  }
  return { questions, fromBank }
}

/** Ties drafts to the batch's concepts: by name, else to the next slot still without a question. */
function assign(drafts: readonly QuestionDraft[], batch: readonly Concept[]): Question[] {
  const open = [...batch]
  const out: Question[] = []
  for (const d of drafts) {
    const byName = open.findIndex((c) => normalize(c.name) === normalize(d.concept))
    const index = Math.max(byName, 0) // no name match: the next open slot
    const concept = open[index]
    if (concept) open.splice(index, 1)
    out.push(toQuestion(concept ? { ...d, concept: concept.name } : d, concept?.id ?? null))
  }
  return out
}

export function reviewTitle(concepts: readonly Concept[]): string {
  const names = concepts.map((c) => c.name)
  const head = names.slice(0, 2).join(', ')
  return names.length > 2 ? `Review · ${head} +${names.length - 2}` : `Review · ${head}`
}
