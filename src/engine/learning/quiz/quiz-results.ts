/**
 * Quiz scoring and gap diagnosis helpers: score, per-concept breakdown, misses → gap-fixer input
 * (P7), and the no-LLM fallback (diagnoses, a repair prompt that follows the student-prompt rules,
 * a next topic).
 */
import type { GapInput, GapOutput } from '@engine/brain-contract'
import type { Answer, MasteryStatus, Question, Quiz, QuizResult } from '@shared/domain'
import { clampWords, normalize, words } from './drafts'

export interface AnsweredQuestion {
  question: Question
  answer: Answer
  correct: boolean
}

export const FIX_PROMPT_MAX_WORDS = 110

/** Answers joined to their questions, oldest first. Correctness is re-derived from the key. */
export function answeredInOrder(quiz: Quiz): AnsweredQuestion[] {
  const byId = new Map(quiz.questions.map((q) => [q.id, q]))
  return [...quiz.answers]
    .sort((a, b) => a.answeredAt.localeCompare(b.answeredAt))
    .flatMap((answer) => {
      const question = byId.get(answer.questionId)
      return question
        ? [{ question, answer, correct: answer.chosenIndex === question.correctIndex }]
        : []
    })
}

export function scoreQuiz(quiz: Quiz): { correct: number; total: number; score: number } {
  const total = quiz.questions.length
  const correct = answeredInOrder(quiz).filter((a) => a.correct).length
  return {
    correct,
    total,
    score: total === 0 ? 0 : Math.round((correct / total) * 10_000) / 10_000,
  }
}

export const missesOf = (quiz: Quiz): AnsweredQuestion[] =>
  answeredInOrder(quiz).filter((a) => !a.correct)

/** One row per concept (in question order); `statusOf` gives the status after the updates. */
export function breakdown(
  quiz: Quiz,
  statusOf: (question: Question, missed: boolean) => MasteryStatus,
): QuizResult['byConcept'] {
  const answered = new Map(answeredInOrder(quiz).map((a) => [a.question.id, a.correct]))
  const groups = new Map<string, Question[]>()
  for (const q of quiz.questions) {
    const key = normalize(q.conceptName)
    groups.set(key, [...(groups.get(key) ?? []), q])
  }
  return [...groups.values()].flatMap((questions) => {
    const first = questions.find((q) => q.conceptId !== null) ?? questions[0]
    if (!first) return []
    const correct = questions.filter((q) => answered.get(q.id) === true).length
    const missed = questions.some((q) => answered.get(q.id) === false)
    return [
      {
        conceptName: first.conceptName,
        correct,
        total: questions.length,
        status: statusOf(first, missed),
      },
    ]
  })
}

export function gapInput(
  misses: readonly AnsweredQuestion[],
  ctx: { assistant: string; language: string; profile: string },
): GapInput {
  return {
    ...ctx,
    misses: misses.map(({ question, answer }) => ({
      concept: question.conceptName,
      stem: question.stem,
      chosen: question.options[answer.chosenIndex] ?? '',
      correct: question.options[question.correctIndex] ?? '',
      rationale: question.rationales[answer.chosenIndex] ?? '',
    })),
  }
}

function repairPrompt(misses: readonly AnsweredQuestion[], subjectLabel: string): string {
  const lines = misses.map(({ question, answer }, i) => {
    const chosen = clampWords(question.options[answer.chosenIndex] ?? '', 5)
    const right = clampWords(question.options[question.correctIndex] ?? '', 5)
    return `${i + 1}. ${clampWords(question.conceptName, 4)}: I chose "${chosen}", but the answer is "${right}".`
  })
  return [
    `I'm studying ${clampWords(subjectLabel, 5)}. In a quiz I got ${misses.length > 1 ? 'these' : 'this'} wrong:`,
    ...lines,
    'For each, contrast my wrong idea with the right one and give one concrete example.',
    'No greetings or small talk; short structured bullets, max ~150 words, bold key terms.',
    'Then quiz me with 2 new questions and wait for my answers.',
  ].join('\n')
}

/** Gap diagnosis without an LLM: rationale-based diagnoses and a templated repair prompt. */
export function fallbackGaps(
  misses: readonly AnsweredQuestion[],
  subjectLabel: string,
  nextTopic: string | null,
): GapOutput {
  const diagnoses = misses.map(({ question, answer }) => {
    const rationale = question.rationales[answer.chosenIndex]?.trim()
    const chosen = question.options[answer.chosenIndex] ?? ''
    return {
      concept: question.conceptName,
      misconception: clampWords(rationale || `Thought "${chosen}" was right`, 12),
    }
  })
  const distinct = misses.filter(
    (m, i) => misses.findIndex((x) => x.question.conceptName === m.question.conceptName) === i,
  )
  let take = Math.min(3, distinct.length)
  let prompt = repairPrompt(distinct.slice(0, take), subjectLabel)
  while (take > 1 && words(prompt).length > FIX_PROMPT_MAX_WORDS) {
    take--
    prompt = repairPrompt(distinct.slice(0, take), subjectLabel)
  }
  return {
    diagnoses,
    prompt,
    nextTopic: nextTopic ?? misses[0]?.question.conceptName ?? '',
  }
}
