import type { Question } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { type AnsweredQuestion, fallbackGaps, stripVerdict } from './quiz-results'

function miss(
  i: number,
  concept: string,
  stem: string,
  chosen: string,
  right: string,
  why: string,
): AnsweredQuestion {
  const question: Question = {
    id: `q${i}`,
    conceptName: concept,
    conceptId: null,
    stem,
    options: [chosen, right, 'Other one', 'Another'],
    correctIndex: 1,
    rationales: [why, 'Correct.', 'No.', 'No.'],
    difficulty: 2,
    carriedFrom: null,
  }
  return {
    question,
    answer: {
      questionId: question.id,
      chosenIndex: 0,
      correct: false,
      answeredAt: `2026-10-25T10:0${i}:00Z`,
    },
    correct: false,
  }
}

// The Egyptian History exam from 2026-10-24: every question labelled with the subject.
const MISSES = [
  miss(
    1,
    'Egyptian History',
    'Which monument is the oldest surviving stone pyramid?',
    'The Great Sphinx of Giza, built in the 3rd dynasty',
    'The pyramid of Djoser at Saqqara',
    'Incorrect: The Sphinx dates to the 4th dynasty, not the 3rd.',
  ),
  miss(
    2,
    'Egyptian History',
    'Which of these was not an Egyptian deity?',
    'Aphrodite',
    'Anubis',
    'Incorrect: Aphrodite is Greek, not an Egyptian deity.',
  ),
  miss(
    3,
    'Egyptian History',
    'The 18th dynasty belongs to which period?',
    'The Middle Kingdom',
    'The New Kingdom',
    'Incorrect: The 18th dynasty is New Kingdom.',
  ),
  miss(
    4,
    'Egyptian History',
    'What were most surviving Egyptian statues made of?',
    'Bronze',
    'Stone',
    'Incorrect: Bronze statues are rare; most surviving statues are stone.',
  ),
]

describe('fallbackGaps (no AI)', () => {
  it('quotes the questions and whole answers, not the subject as a topic', () => {
    const { prompt } = fallbackGaps(MISSES, 'Egyptian History', null)
    expect(prompt).toContain('these 3 questions wrong')
    expect(prompt).toContain(
      '1. Which monument is the oldest surviving stone pyramid? I answered "The Great Sphinx of Giza, built in the 3rd dynasty"; the answer is "The pyramid of Djoser at Saqqara".',
    )
    expect(prompt).not.toContain('Egyptian History —')
    expect(prompt).not.toContain('…')
    expect(prompt).toMatch(/ask me 2 new questions on the same ideas, one at a time/)
  })

  it('names real topics and lists different topics first', () => {
    const misses = [
      miss(1, 'Old Kingdom', 'Q1?', 'a', 'b', 'x'),
      miss(2, 'Old Kingdom', 'Q2?', 'a', 'b', 'x'),
      miss(3, 'Deities', 'Q3?', 'a', 'b', 'x'),
    ]
    const { prompt } = fallbackGaps(misses, 'Egyptian History', null)
    expect(prompt).toContain('1. Old Kingdom — Q1?')
    expect(prompt).toContain('2. Deities — Q3?')
    expect(prompt).toContain('3. Old Kingdom — Q2?')
  })

  it('drops the "Incorrect:" label from the diagnoses', () => {
    const { diagnoses } = fallbackGaps(MISSES, 'Egyptian History', null)
    expect(diagnoses[1]?.misconception).toBe('Aphrodite is Greek, not an Egyptian deity.')
  })
})

describe('stripVerdict', () => {
  it('keeps the lesson, not the label', () => {
    expect(stripVerdict('Wrong — the 18th dynasty is New Kingdom.')).toBe(
      'the 18th dynasty is New Kingdom.',
    )
    expect(stripVerdict('Correct.')).toBe('')
  })
})
