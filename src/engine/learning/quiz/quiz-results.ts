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

/** Repair prompts quote the questions, so they may run longer than a step prompt. */
export const FIX_PROMPT_MAX_WORDS = 170

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

/** "Incorrect: The 18th dynasty is…" → "The 18th dynasty is…": the label is not the lesson. */
export function stripVerdict(text: string): string {
  return text
    .replace(/^\s*(incorrect|wrong|not quite|correct|right|no|yes)\s*[:.!—–-]\s*/i, '')
    .trim()
}

function repairPrompt(
  misses: readonly AnsweredQuestion[],
  subjectLabel: string,
  ask: number,
): string {
  const subject = normalize(subjectLabel)
  const lines = misses.map(({ question, answer }, i) => {
    const topic = normalize(question.conceptName) === subject ? '' : `${question.conceptName} — `
    const stem = clampWords(question.stem, 22)
    const chosen = clampWords(question.options[answer.chosenIndex] ?? '', 14)
    const right = clampWords(question.options[question.correctIndex] ?? '', 14)
    return `${i + 1}. ${topic}${stem} I answered "${chosen}"; the answer is "${right}".`
  })
  const n = misses.length
  return [
    `I'm studying ${clampWords(subjectLabel, 5)}. In a quiz I got ${n === 1 ? 'this question' : `these ${n} questions`} wrong:`,
    ...lines,
    `For each: say in one line what I probably confused, explain the right idea in 2–3 bullets, and give one concrete example.`,
    'No greetings or small talk; short structured bullets, bold key terms.',
    `Then ask me ${ask} new ${ask === 1 ? 'question' : 'questions'} on the same ideas, one at a time, and wait for my answer.`,
  ].join('\n')
}

/** Gap diagnosis without an LLM: rationale-based diagnoses and a templated repair prompt. */
export function fallbackGaps(
  misses: readonly AnsweredQuestion[],
  subjectLabel: string,
  nextTopic: string | null,
): GapOutput {
  const diagnoses = misses.map(({ question, answer }) => {
    const rationale = stripVerdict(question.rationales[answer.chosenIndex] ?? '')
    const chosen = question.options[answer.chosenIndex] ?? ''
    return {
      concept: question.conceptName,
      misconception: clampWords(rationale || `Thought "${chosen}" was right`, 16),
    }
  })
  // Different topics first, then more misses of the same topic: every miss counts, not one per
  // label (a subject-wide label would otherwise collapse a whole exam into one line).
  const seen = new Set<string>()
  const firstOfTopic = misses.filter((m) => {
    const k = normalize(m.question.conceptName)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
  const ordered = [...firstOfTopic, ...misses.filter((m) => !firstOfTopic.includes(m))]
  let take = Math.min(3, ordered.length)
  let prompt = repairPrompt(ordered.slice(0, take), subjectLabel, Math.min(2, take))
  while (take > 1 && words(prompt).length > FIX_PROMPT_MAX_WORDS) {
    take--
    prompt = repairPrompt(ordered.slice(0, take), subjectLabel, Math.min(2, take))
  }
  return {
    diagnoses,
    prompt,
    nextTopic: nextTopic ?? misses[0]?.question.conceptName ?? '',
  }
}
