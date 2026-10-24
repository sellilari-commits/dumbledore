/**
 * Just-in-time checkpoint quizzes (P5, PLAN §6.6/D11): generated from what the AI actually
 * explained, re-testing carried misses, then checked by the blind verifier. A question whose key
 * the verifier disputes is regenerated (max 2 tries) or dropped.
 */
import type { CheckpointItem, Id, LearnItem, Probe, Question, Quiz, Roadmap } from '@shared/domain'
import {
  type Brain,
  type CheckpointInput,
  QuestionDraft,
  type VerifyResult,
} from '../../brain-contract'
import type { Clock } from '../../clock'
import type { Repos } from '../../contracts'
import { newId } from '../../ids'
import { withDeadline } from './deadline'
import { clampQuestions } from './materialize'
import { isCheckpoint, isLearn, recentMisses } from './roadmap-ops'
import { norm, tail, uniqueBy, uniqueNames } from './text'

export interface CheckpointQuizDeps {
  repos: Repos
  brain: Brain
  clock: Clock
}

export interface CheckpointQuizOptions {
  checkpointTimeoutMs: number
  verifyTimeoutMs: number
  maxRegenerateTries: number
}

export interface CheckpointQuizRequest {
  roadmap: Roadmap
  item: CheckpointItem
  /** What the AI explained (chat excerpt), the questions' grounding. */
  studied: string
  language: string
  nowIso: string
}

/**
 * What the quiz is grounded in: the newest chat excerpt, or — when no chat text is available —
 * the titles and objectives of the steps since the previous checkpoint.
 */
export function studiedText(
  roadmap: Roadmap,
  item: CheckpointItem,
  chatExcerpt: string,
  maxChars: number,
): string {
  const excerpt = tail(chatExcerpt, maxChars)
  if (excerpt) return excerpt
  const since = roadmap.items.filter((i) => isCheckpoint(i) && i.idx < item.idx).at(-1)?.idx ?? -1
  return roadmap.items
    .filter((i): i is LearnItem => isLearn(i) && i.idx > since && i.idx < item.idx)
    .map((i) => `${i.title}: ${i.objective}`)
    .join('\n')
}

/** Builds the CheckpointInput the quizmaster gets for this item (covers + carry, probes, n). */
export function checkpointInput(req: CheckpointQuizRequest): CheckpointInput {
  const { roadmap, item } = req
  const concepts = uniqueNames([...item.covers, ...roadmap.carry])
  return {
    concepts: concepts.length > 0 ? concepts : [roadmap.title],
    probes: uniqueBy(
      [...item.probes, ...recentMisses(roadmap)],
      (p) => `${norm(p.concept)}|${norm(p.misconception)}`,
    ),
    carry: [...roadmap.carry],
    n: clampQuestions(item.nQuestions),
    studied: req.studied,
    language: req.language,
  }
}

export async function buildCheckpointQuiz(
  deps: CheckpointQuizDeps,
  req: CheckpointQuizRequest,
  opts: CheckpointQuizOptions,
): Promise<Quiz> {
  const input = checkpointInput(req)
  const generate = async (i: CheckpointInput) =>
    valid(
      await withDeadline(deps.clock, opts.checkpointTimeoutMs, 'makeCheckpoint', (call) =>
        deps.brain.makeCheckpoint(i, call),
      ),
    ).slice(0, i.n)

  const drafts = await generate(input)
  if (drafts.length === 0) throw new Error('the quizmaster returned no usable questions')
  const verified = await verifyAndRepair(deps, drafts, input, generate, opts)
  if (verified.length === 0) throw new Error('no checkpoint question passed verification')

  const { roadmap, item } = req
  const carried = new Set(roadmap.carry.map(norm))
  const questions: Question[] = verified.map((d) => ({
    id: newId('qst'),
    conceptName: d.concept,
    conceptId: deps.repos.concepts.upsert({ subjectId: roadmap.subjectId, name: d.concept }).id,
    stem: d.stem,
    options: d.options,
    correctIndex: d.correctIndex,
    rationales: d.rationales,
    difficulty: d.difficulty,
    carriedFrom: carried.has(norm(d.concept))
      ? findMissedQuestion(deps.repos, roadmap, d.concept)
      : null,
  }))
  return {
    id: newId('quz'),
    kind: 'checkpoint',
    title: `${item.title.split(' · ')[0] ?? 'Checkpoint'} · ${roadmap.title}`,
    subjectIds: [roadmap.subjectId],
    roadmapId: roadmap.id,
    roadmapItemId: item.id,
    status: 'ready',
    questions,
    answers: [],
    score: null,
    createdAt: req.nowIso,
    completedAt: null,
  }
}

function valid(drafts: unknown[]): QuestionDraft[] {
  return drafts.flatMap((d) => {
    const parsed = QuestionDraft.safeParse(d)
    if (!parsed.success) return []
    const q = parsed.data
    if (!q.stem.trim() || !q.concept.trim() || q.options.some((o) => !o.trim())) return []
    return [q]
  })
}

interface Slot {
  slot: number
  draft: QuestionDraft
}

async function verifyAndRepair(
  deps: CheckpointQuizDeps,
  drafts: QuestionDraft[],
  input: CheckpointInput,
  generate: (i: CheckpointInput) => Promise<QuestionDraft[]>,
  opts: CheckpointQuizOptions,
): Promise<QuestionDraft[]> {
  const accepted: (QuestionDraft | null)[] = drafts.map(() => null)
  let toCheck: Slot[] = drafts.map((draft, slot) => ({ slot, draft }))
  for (let attempt = 0; toCheck.length > 0; attempt++) {
    const results = await verify(
      deps,
      toCheck.map((s) => s.draft),
      opts.verifyTimeoutMs,
    )
    const mismatched: Slot[] = []
    toCheck.forEach((s, k) => {
      const r = results?.find((x) => x.index === k)
      // No verdict (verifier down or silent) → keep the question rather than lose the checkpoint.
      if (!r || r.chosen === s.draft.correctIndex) accepted[s.slot] = s.draft
      else mismatched.push(s)
    })
    if (mismatched.length === 0 || attempt >= opts.maxRegenerateTries) break
    toCheck = await regenerate(mismatched, input, generate)
  }
  return accepted.filter((d): d is QuestionDraft => d !== null)
}

async function verify(
  deps: CheckpointQuizDeps,
  drafts: QuestionDraft[],
  timeoutMs: number,
): Promise<VerifyResult[] | null> {
  try {
    return await withDeadline(deps.clock, timeoutMs, 'verifyQuestions', (call) =>
      deps.brain.verifyQuestions(drafts, call),
    )
  } catch (error) {
    console.warn('[study] verifier unavailable, keeping questions unverified', error)
    return null
  }
}

/** New drafts for the disputed slots, matched by concept; slots without a new draft are dropped. */
async function regenerate(
  mismatched: Slot[],
  input: CheckpointInput,
  generate: (i: CheckpointInput) => Promise<QuestionDraft[]>,
): Promise<Slot[]> {
  const concepts = uniqueNames(mismatched.map((s) => s.draft.concept))
  const keys = new Set(concepts.map(norm))
  let fresh: QuestionDraft[]
  try {
    fresh = await generate({
      ...input,
      concepts,
      probes: input.probes.filter((p: Probe) => keys.has(norm(p.concept))),
      carry: input.carry.filter((c) => keys.has(norm(c))),
      n: clampQuestions(mismatched.length),
    })
  } catch (error) {
    console.warn('[study] regenerating disputed questions failed; dropping them', error)
    return []
  }
  const pool = [...fresh]
  const take = (concept: string): QuestionDraft | undefined => {
    const i = pool.findIndex((d) => norm(d.concept) === norm(concept))
    return pool.splice(Math.max(i, 0), 1)[0]
  }
  return mismatched.flatMap((s) => {
    const draft = pool.length > 0 ? take(s.draft.concept) : undefined
    return draft ? [{ slot: s.slot, draft }] : []
  })
}

/** The newest wrongly answered question on `concept` (this roadmap first, then the subject). */
export function findMissedQuestion(repos: Repos, roadmap: Roadmap, concept: string): Id | null {
  const key = norm(concept)
  const own = roadmap.items
    .filter(isCheckpoint)
    .map((i) => i.quizId)
    .filter((id): id is Id => id !== null)
    .reverse()
    .map((id) => repos.quizzes.get(id))
    .filter((q): q is Quiz => q !== null)
  const quizzes = [...own, ...repos.quizzes.list({ subjectId: roadmap.subjectId, limit: 10 })]
  for (const quiz of quizzes) {
    for (const answer of [...quiz.answers].reverse()) {
      if (answer.correct) continue
      const question = quiz.questions.find((q) => q.id === answer.questionId)
      if (question && norm(question.conceptName) === key) return question.id
    }
  }
  return null
}
