/**
 * P5 Checkpoint quizmaster (tier `reason`) and blind verifier: questions that test understanding
 * (why / apply-predict / contrast-spot-the-error) grounded in what the student studied, with
 * misconception distractors; the verifier answers without the key so callers can drop or
 * regenerate questions whose key it disputes. Shared question rules and checks live here too.
 */
import type { CheckpointInput, QuestionDraft, VerifyResult } from '@engine/brain-contract'
import { z } from 'zod'
import { clip, looksFinnish } from '../llm/text'
import { bullets, languageName, type PromptSpec, tag } from './shared'

export const LlmQuestion = z.object({
  concept: z.string().min(1),
  stem: z.string().min(1),
  options: z.array(z.string().min(1)).length(4),
  correctIndex: z.number().int().min(0).max(3),
  rationales: z.array(z.string()).length(4),
  difficulty: z.number().int().min(1).max(3),
})
export const LlmQuestions = z.object({ questions: z.array(LlmQuestion).min(1) })
export type LlmQuestions = z.infer<typeof LlmQuestions>

export const QUESTION_RULES = `Each question:
- stem ≤ 35 words, self-contained (never "according to the text", never "which is NOT").
- exactly 4 options of similar length and style; exactly one is correct.
- distractors are misconceptions a real learner would hold; no jokes, no "all of the above", "none of the above" or "both A and B".
- rationales: one per option in the same order, ≤ 25 words, saying why that option is right or wrong.
- difficulty 1–3 (aim for 2: challenging but fair); concept = the concept it tests, using the given names.
Before finalising, silently solve each question; if two options could be argued correct, rewrite it.`

const BANNED_OPTION =
  /\b(all|none|both) of the above\b|^both [a-d] and [a-d]$|^(kaikki|ei mikään) (yllä|edellä)/i

/** Rule violations in generated questions (empty = fine). */
export function checkQuestions(questions: QuestionDraft[], wanted: number): string[] {
  const issues: string[] = []
  if (questions.length < wanted)
    issues.push(`only ${questions.length} questions; write exactly ${wanted}`)
  const stems = new Set<string>()
  questions.forEach((q, i) => {
    const key = q.stem.trim().toLowerCase()
    if (stems.has(key)) issues.push(`questions.${i}: duplicate of an earlier question`)
    stems.add(key)
    if (q.options.some((o) => BANNED_OPTION.test(o.trim()))) {
      issues.push(
        `questions.${i}: uses an "all/none of the above"-style option; replace it with a real misconception`,
      )
    }
    if (new Set(q.options.map((o) => o.trim().toLowerCase())).size < 4)
      issues.push(`questions.${i}: options repeat`)
    if (q.stem.split(/\s+/).length > 45) issues.push(`questions.${i}: stem is longer than 35 words`)
  })
  return issues
}

function seededRandom(seed: string): () => number {
  let h = 2166136261
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619)
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507)
    h = Math.imul(h ^ (h >>> 13), 3266489909)
    h ^= h >>> 16
    return (h >>> 0) / 4294967296
  }
}

/** Spreads correct answers across A–D (models favour A/B); numeric options are sorted instead. */
export function shuffleQuestion(q: QuestionDraft): QuestionDraft {
  const order = [0, 1, 2, 3]
  const numeric = q.options.every((o) => /^[-−]?\d[\d\s.,]*(\s*\S{0,6})?$/.test(o.trim()))
  if (numeric) {
    const value = (o: string) => Number.parseFloat(o.replace(/[−]/g, '-').replace(/[\s,]/g, ''))
    order.sort((a, b) => value(q.options[a] as string) - value(q.options[b] as string))
  } else {
    const rand = seededRandom(q.stem)
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1))
      ;[order[i], order[j]] = [order[j] as number, order[i] as number]
    }
  }
  return {
    ...q,
    options: order.map((i) => q.options[i] as string),
    rationales: order.map((i) => q.rationales[i] as string),
    correctIndex: order.indexOf(q.correctIndex),
  }
}

export function finalizeQuestions(questions: QuestionDraft[], n: number): QuestionDraft[] {
  const seen = new Set<string>()
  return questions
    .filter((q) => {
      const key = q.stem.trim().toLowerCase()
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, n)
    .map((q) =>
      shuffleQuestion({ ...q, stem: q.stem.trim(), options: q.options.map((o) => o.trim()) }),
    )
}

export function checkpointLanguage(input: CheckpointInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(`${input.concepts.join(' ')}\n${input.studied}`) ? 'fi' : 'en'
}

function system(input: CheckpointInput, lang: string): string {
  return `You write multiple-choice checkpoint questions that prove a student understood a few concepts — not that they memorised wording.
- Ground every question in what the student actually studied (<studied>); don't test details they never saw.
- Mix question types: a conceptual "why", an apply-to-a-new-case or predict-the-outcome, and a contrast or spot-the-error; add more of these as needed.
- Build distractors from the misconceptions in <probes>.
- Concepts in <carry> were missed before: re-test each with a fresh scenario, never a reworded old question.
- Cover every concept in <concepts> at least once when there are enough questions.

${QUESTION_RULES}

Write exactly ${input.n} questions in ${languageName(lang)}.`
}

function user(input: CheckpointInput): string {
  return [
    tag('concepts', bullets(input.concepts)),
    tag('probes', bullets(input.probes.map((p) => `${p.concept}: ${p.misconception}`))),
    tag('carry', bullets(input.carry)),
    tag(
      'studied',
      input.studied.trim()
        ? clip(input.studied, 6000)
        : '(no excerpt — use standard material for these concepts)',
    ),
  ].join('\n')
}

export const checkpointPrompt: PromptSpec<CheckpointInput, LlmQuestions, QuestionDraft[]> = {
  id: 'P5',
  task: 'makeCheckpoint',
  version: 1,
  tier: 'reason',
  temperature: 0.3,
  maxOutputTokens: 4500,
  reasoningEffort: 'medium',
  schemaName: 'checkpoint',
  schema: LlmQuestions,
  onDeviceOk: false,
  cacheable: false, // regenerating must give new questions
  language: checkpointLanguage,
  build: (input) => ({ system: system(input, checkpointLanguage(input)), user: user(input) }),
  check: (out, input) => checkQuestions(out.questions, input.n),
  finalize: (out, input) => finalizeQuestions(out.questions, input.n),
}

// ─── Blind verifier ──────────────────────────────────────────────────────────────────────────

export const LlmVerify = z.object({
  answers: z.array(
    z.object({
      index: z.number().int(),
      chosen: z.number().int().min(0).max(3),
      confidence: z.number(),
    }),
  ),
})
export type LlmVerify = z.infer<typeof LlmVerify>

const LETTERS = ['A', 'B', 'C', 'D']

export const verifyPrompt: PromptSpec<QuestionDraft[], LlmVerify, VerifyResult[]> = {
  id: 'P5v',
  task: 'verifyQuestions',
  version: 1,
  tier: 'extract',
  temperature: 0,
  maxOutputTokens: 2500,
  reasoningEffort: 'medium',
  schemaName: 'answers',
  schema: LlmVerify,
  onDeviceOk: false, // the 3B on-device model is too weak to judge answer keys
  cacheable: true,
  language: (qs) => (looksFinnish(qs.map((q) => q.stem).join('\n')) ? 'fi' : 'en'),
  build: (qs) => ({
    system:
      'Answer each multiple-choice question on your own. For each, pick the single best option: chosen = 0 for A, 1 for B, 2 for C, 3 for D. confidence = the probability that your choice is correct (0–1); lower it when the question is ambiguous or two options seem defensible. Answer every question, using its index.',
    user: qs
      .map(
        (q, i) =>
          `Q${i} (index ${i}). ${q.stem}\n${q.options.map((o, k) => `${LETTERS[k]}) ${o}`).join('\n')}`,
      )
      .join('\n\n'),
  }),
  check(out, qs) {
    const got = new Set(out.answers.map((a) => a.index))
    const missing = qs.map((_, i) => i).filter((i) => !got.has(i))
    return missing.length ? [`answers missing for indexes ${missing.join(', ')}`] : []
  },
  finalize(out, qs) {
    const byIndex = new Map(out.answers.map((a) => [a.index, a]))
    return qs.flatMap((_, index) => {
      const a = byIndex.get(index)
      return a
        ? [{ index, chosen: a.chosen, confidence: Math.min(1, Math.max(0, a.confidence)) }]
        : []
    })
  },
}
