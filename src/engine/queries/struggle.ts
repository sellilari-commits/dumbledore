/**
 * Why a concept counts as "struggling", in a few words for Home and the memory file:
 * quiz misses first ("missed 2 of 3 in checkpoint 1"), then reading evidence, then the count.
 */
import type { Concept, Encounter, Quiz } from '@shared/domain'
import { normalizeName } from '../store/codec'

const QUIZ_LABEL: Record<Quiz['kind'], (q: Quiz) => string> = {
  checkpoint: (q) => q.title.charAt(0).toLowerCase() + q.title.slice(1),
  exam: () => 'your last exam',
  review: () => 'your last review',
  placement: () => 'the placement check',
}

const clip = (text: string, max: number): string => {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length <= max ? flat : `${flat.slice(0, max - 1).trimEnd()}…`
}

/**
 * @param quizzes the concept's subject's quizzes, newest first
 * @param encounters the concept's subject's encounters, newest first
 */
export function struggleReason(
  concept: Concept,
  quizzes: readonly Quiz[],
  encounters: readonly Encounter[],
): string {
  const key = normalizeName(concept.name)
  for (const quiz of quizzes) {
    const ids = new Set(
      quiz.questions
        .filter((q) => q.conceptId === concept.id || normalizeName(q.conceptName) === key)
        .map((q) => q.id),
    )
    const answers = quiz.answers.filter((a) => ids.has(a.questionId))
    if (answers.length === 0) continue
    const missed = answers.filter((a) => !a.correct).length
    if (missed > 0) return `missed ${missed} of ${answers.length} in ${QUIZ_LABEL[quiz.kind](quiz)}`
    break
  }
  const struggled = encounters.find(
    (e) =>
      e.conceptId === concept.id && e.understanding === 'struggling' && e.inboxState !== 'ignored',
  )
  if (struggled?.evidence.trim()) return clip(struggled.evidence, 100)
  if (concept.struggleCount > 0) return `struggled ${concept.struggleCount}× recently`
  return 'needs another look'
}
