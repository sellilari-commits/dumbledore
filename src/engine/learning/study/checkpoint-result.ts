/**
 * Converts a finished checkpoint quiz into the outcome the roadmap records: the QuizResult from
 * lane L5's QuizService, or — when that hook never fired (crash, restart) — the stored answers.
 */
import type { Id, MasteryStatus, Quiz, QuizResult, Roadmap } from '@shared/domain'
import {
  applyCheckpointOutcome,
  type CheckpointOutcome,
  closeItem,
  currentIndex,
  isCheckpoint,
  isLearn,
} from './roadmap-ops'
import { uniqueNames } from './text'

/**
 * The roadmap after a finished checkpoint quiz, or null when the result doesn't apply (not a
 * checkpoint of this roadmap, or already recorded). A quiz taken early from the side stack
 * closes the learn steps before it.
 */
export function roadmapAfterResult(
  roadmap: Roadmap,
  quiz: Quiz,
  result: QuizResult,
  nowIso: string,
): Roadmap | null {
  if (quiz.kind !== 'checkpoint' || quiz.roadmapId !== roadmap.id) return null
  const idx = roadmap.items.findIndex((i) => i.id === quiz.roadmapItemId)
  const item = roadmap.items[idx]
  if (!isCheckpoint(item) || item.status === 'done' || item.status === 'skipped') return null
  let base = roadmap
  for (
    let k = currentIndex(base);
    k >= 0 && k < idx && isLearn(base.items[k]);
    k = currentIndex(base)
  ) {
    base = closeItem(base, k, nowIso)
  }
  return applyCheckpointOutcome(base, item.id, outcomeFromResult(quiz.id, result), nowIso)
}

export function outcomeFromResult(quizId: Id, result: QuizResult): CheckpointOutcome {
  const missed = result.byConcept.filter((c) => c.correct < c.total).map((c) => c.conceptName)
  const passed = result.byConcept
    .filter((c) => c.total > 0 && c.correct === c.total)
    .map((c) => c.conceptName)
  return {
    quizId,
    score: result.score,
    missed: uniqueNames([...missed, ...result.gaps.map((g) => g.concept)]),
    passed,
    gaps: result.gaps,
  }
}

/** A minimal QuizResult rebuilt from a quiz's stored answers (unanswered questions count wrong). */
export function resultFromQuiz(quiz: Quiz): QuizResult {
  const byConcept = new Map<string, { conceptName: string; correct: number; total: number }>()
  const gaps: QuizResult['gaps'] = []
  let correct = 0
  for (const question of quiz.questions) {
    const answer = quiz.answers.find((a) => a.questionId === question.id)
    const row = byConcept.get(question.conceptName) ?? {
      conceptName: question.conceptName,
      correct: 0,
      total: 0,
    }
    row.total++
    if (answer?.correct) {
      row.correct++
      correct++
    } else {
      const chosen = answer ? question.options[answer.chosenIndex] : undefined
      gaps.push({
        concept: question.conceptName,
        misconception: chosen ? `Chose: ${chosen}` : 'Left unanswered',
      })
    }
    byConcept.set(question.conceptName, row)
  }
  const total = quiz.questions.length
  const status = (c: number, t: number): MasteryStatus => (c === t ? 'learning' : 'struggling')
  return {
    quizId: quiz.id,
    score: total > 0 ? correct / total : 0,
    correct,
    total,
    byConcept: [...byConcept.values()].map((r) => ({ ...r, status: status(r.correct, r.total) })),
    gaps,
    fixPrompt: null,
    nextTopic: null,
  }
}
