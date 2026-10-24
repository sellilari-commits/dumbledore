/** exam-utils: gap rows (picked option vs. a diagnosis in words), titles, meta lines. */
import type { Question, Quiz, SubjectSummary } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { gapRows, metaLine, scoreText, shortTitle } from './exam-utils'

function question(id: string, conceptName: string, options: string[]): Question {
  return {
    id,
    conceptName,
    conceptId: null,
    stem: `Stem ${id}`,
    options,
    correctIndex: 0,
    rationales: options.map((o) => `Why ${o}`),
    difficulty: 2,
    carriedFrom: null,
  }
}

const QUIZ: Quiz = {
  id: 'quiz_t',
  kind: 'exam',
  title: 'Weak-spots exam · Organic Chemistry',
  subjectIds: ['sub_orgo'],
  roadmapId: null,
  roadmapItemId: null,
  status: 'done',
  questions: [
    question('q1', 'Carbocation stability', ['3°', '1°', 'methyl', 'vinyl']),
    question('q2', 'SN2 mechanism', ['inversion', 'retention', 'racemic', 'none']),
    question('q3', 'Carbocation stability', ['hyperconjugation', 'sp³', 'crowding', 'none']),
  ],
  answers: [
    { questionId: 'q1', chosenIndex: 1, correct: false, answeredAt: '2026-10-24T10:00:00Z' },
    { questionId: 'q2', chosenIndex: 0, correct: true, answeredAt: '2026-10-24T10:01:00Z' },
    { questionId: 'q3', chosenIndex: 2, correct: false, answeredAt: '2026-10-24T10:02:00Z' },
  ],
  score: 1 / 3,
  createdAt: '2026-10-24T09:59:00Z',
  completedAt: '2026-10-24T10:03:00Z',
}

describe('gapRows', () => {
  it('merges a concept’s gaps and links the questions missed on it', () => {
    const rows = gapRows(
      [
        { concept: 'Carbocation stability', misconception: '1°' },
        { concept: 'Carbocation stability', misconception: 'crowding' },
      ],
      QUIZ,
    )
    expect(rows).toEqual([
      {
        concept: 'Carbocation stability',
        picked: ['1°', 'crowding'],
        notes: [],
        questions: [1, 3],
      },
    ])
  })

  it('keeps a diagnosis in words apart from picked options', () => {
    const rows = gapRows(
      [
        {
          concept: 'Carbocation stability',
          misconception: 'Treats primary carbocations as stable',
        },
      ],
      QUIZ,
    )
    expect(rows[0]?.picked).toEqual([])
    expect(rows[0]?.notes).toEqual(['Treats primary carbocations as stable'])
    expect(rows[0]?.questions).toEqual([1, 3])
  })

  it('still lists a gap whose concept has no missed question', () => {
    const rows = gapRows([{ concept: 'Solvent effects', misconception: 'DMSO is protic' }], QUIZ)
    expect(rows).toEqual([
      { concept: 'Solvent effects', picked: [], notes: ['DMSO is protic'], questions: [] },
    ])
  })
})

describe('labels', () => {
  const orgo = { id: 'sub_orgo', name: 'Organic Chemistry', emoji: '🧪' } as SubjectSummary

  it('drops the subject suffix only when a column shows it', () => {
    expect(shortTitle('Weak-spots exam · Organic Chemistry', [orgo])).toBe('Weak-spots exam')
    expect(shortTitle('5-minute review · Carbocations', [orgo])).toBe(
      '5-minute review · Carbocations',
    )
  })

  it('formats scores and meta lines', () => {
    expect(scoreText(0.7, 10)).toBe('7/10 · 70%')
    expect(metaLine(['5 questions', '', null, 'about 4 min'])).toBe('5 questions · about 4 min')
  })
})
