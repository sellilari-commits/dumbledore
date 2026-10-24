/**
 * P6 Exam builder (tier `reason`): the P5 question rules plus scope selection (weak spots / due /
 * everything), interleaving, a difficulty ramp and transfer questions. Exams are generated in
 * batches of ≤ 5 questions (Groq's 8K tokens/minute cap); `planExam` decides which concept each
 * question tests and the difficulty of each batch.
 */
import type { ExamInput, QuestionDraft } from '@engine/brain-contract'
import { clip, looksFinnish } from '../llm/text'
import { checkQuestions, finalizeQuestions, LlmQuestions, QUESTION_RULES } from './p05-quiz'
import { bullets, languageName, type PromptSpec, tag } from './shared'

export const EXAM_BATCH_SIZE = 5

export interface ExamBatch {
  subjects: string[]
  /** One concept per question, in order. */
  plan: { concept: string; status: string; mastery: number }[]
  difficulty: 'easy' | 'medium' | 'hard'
  focus: ExamInput['spec']['focus']
  studied: string
  language: string
  avoid: string[]
}

export function examLanguage(input: ExamInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  const text = [...input.concepts.map((c) => c.name), ...input.encounters.map((e) => e.seen)].join(
    '\n',
  )
  return looksFinnish(text) ? 'fi' : 'en'
}

/** Splits an exam into ≤ 5-question batches with concepts chosen by focus and a difficulty ramp. */
export function planExam(input: ExamInput): Omit<ExamBatch, 'avoid'>[] {
  const count = input.spec.count
  let pool = [...input.concepts]
  if (input.spec.focus === 'weak') {
    const rank = (s: string) =>
      s === 'struggling' ? 0 : s === 'new' ? 1 : s === 'learning' ? 2 : 3
    pool.sort((a, b) => rank(a.status) - rank(b.status) || a.mastery - b.mastery)
    const weak = pool.filter((c) => c.status !== 'mastered')
    pool = (weak.length ? weak : pool).slice(0, Math.max(3, Math.ceil(count / 2)))
  } else if (input.spec.focus === 'due') {
    pool.sort((a, b) => a.mastery - b.mastery)
  }
  if (pool.length === 0) {
    pool = input.subjects.map((s) => ({ name: s.name, status: 'new' as const, mastery: 0 }))
  }
  const perQuestion = Array.from(
    { length: count },
    (_, i) => pool[i % pool.length] as (typeof pool)[number],
  )
  const batches = Math.ceil(count / EXAM_BATCH_SIZE)
  const studied = input.encounters
    .slice(0, 15)
    .map((e) => `- ${e.seen} (${e.bigPicture})`)
    .join('\n')
  return Array.from({ length: batches }, (_, b) => {
    const plan = perQuestion.slice(b * EXAM_BATCH_SIZE, (b + 1) * EXAM_BATCH_SIZE)
    const ramp = batches === 1 ? 'medium' : b === 0 ? 'easy' : b === batches - 1 ? 'hard' : 'medium'
    const difficulty =
      input.spec.difficulty === 'easy' ? 'easy' : input.spec.difficulty === 'hard' ? 'hard' : ramp
    return {
      subjects: input.subjects.map((s) => s.name),
      plan: plan.map((c) => ({ concept: c.name, status: c.status, mastery: c.mastery })),
      difficulty,
      focus: input.spec.focus,
      studied,
      language: examLanguage(input),
    }
  })
}

const FOCUS: Record<ExamBatch['focus'], string> = {
  weak: 'weak-spots exam: the concepts the student struggles with most',
  due: 'review exam: concepts due for spaced review',
  everything: 'full exam across everything the student has studied',
}
const DIFFICULTY: Record<ExamBatch['difficulty'], string> = {
  easy: 'mostly difficulty 1–2',
  medium: 'mostly difficulty 2, order from easier to harder',
  hard: 'mostly difficulty 2–3',
}

function system(b: ExamBatch): string {
  return `You write questions for a student's ${FOCUS[b.focus]}.
- Test understanding and transfer, not recall: at least one question per concept should apply it in a context the student has not seen.
- Base questions on what the student studied (<studied>) where possible; otherwise on standard course material at their level.
- Write one question per line of <plan>, in that order, testing that concept. Make questions that share a concept clearly different.
- Difficulty: ${DIFFICULTY[b.difficulty]}.
- Never repeat or reword a question from <avoid>.

${QUESTION_RULES}

Write exactly ${b.plan.length} questions in ${languageName(b.language)}.`
}

function user(b: ExamBatch): string {
  return [
    tag('subjects', bullets(b.subjects)),
    tag(
      'plan',
      b.plan
        .map(
          (p, i) => `${i + 1}. ${p.concept} (${p.status}, mastery ${Math.round(p.mastery * 100)}%)`,
        )
        .join('\n'),
    ),
    tag('studied', b.studied ? clip(b.studied, 5000) : '(nothing recorded)'),
    tag('avoid', bullets(b.avoid.slice(-15))),
  ].join('\n')
}

export const examBatchPrompt: PromptSpec<ExamBatch, LlmQuestions, QuestionDraft[]> = {
  id: 'P6',
  task: 'makeExam',
  version: 1,
  tier: 'reason',
  temperature: 0.3,
  maxOutputTokens: 3200,
  reasoningEffort: 'low',
  schemaName: 'exam_questions',
  schema: LlmQuestions,
  onDeviceOk: false,
  cacheable: false,
  language: (b) => b.language,
  build: (b) => ({ system: system(b), user: user(b) }),
  check: (out, b) => checkQuestions(out.questions, b.plan.length),
  finalize: (out, b) => finalizeQuestions(out.questions, b.plan.length),
}
