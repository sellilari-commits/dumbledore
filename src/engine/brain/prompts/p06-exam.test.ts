import type { ExamInput, QuestionDraft } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { OPEN_TOPIC, planExam, topicIssues } from './p06-exam'

const input = (concepts: ExamInput['concepts']): ExamInput => ({
  subjects: [{ id: 'sub_egypt', name: 'Egyptian History' }],
  spec: { subjectIds: ['sub_egypt'], focus: 'weak', count: 5, difficulty: 'mixed' },
  concepts,
  encounters: [],
  language: 'en',
})

const q = (concept: string): QuestionDraft => ({
  concept,
  stem: 'Who built Abu Simbel?',
  options: ['Ramesses II', 'Khufu', 'Hatshepsut', 'Akhenaten'],
  correctIndex: 0,
  rationales: ['Yes', 'No', 'No', 'No'],
  difficulty: 2,
})

describe('P6 topics', () => {
  it('asks for a specific topic per question when the subject has none yet', () => {
    const [batch] = planExam(input([]))
    expect(batch?.plan.every((p) => p.concept === `${OPEN_TOPIC} Egyptian History`)).toBe(true)
  })

  it('names the goal on the open-topic line, so the topics serve it', () => {
    const withGoal = input([])
    withGoal.subjects = [
      {
        ...withGoal.subjects[0],
        id: 'sub_egypt',
        name: 'Egyptian History',
        goal: 'The New Kingdom pharaohs',
      },
    ]
    const [batch] = planExam(withGoal)
    expect(batch?.plan[0]?.concept).toBe(
      `${OPEN_TOPIC} Egyptian History (goal: The New Kingdom pharaohs)`,
    )
  })

  it('keeps known concepts in the plan', () => {
    const [batch] = planExam(input([{ name: 'Ramesses II', status: 'struggling', mastery: 0.2 }]))
    expect(batch?.plan[0]?.concept).toBe('Ramesses II')
  })

  it('flags a question labelled with the subject or the open-topic line', () => {
    const [batch] = planExam(input([]))
    if (!batch) throw new Error('no batch')
    const issues = topicIssues(
      [q('Ramesses II'), q('Egyptian history'), q(`${OPEN_TOPIC} Egyptian History`)],
      { ...batch, avoid: [] },
    )
    expect(issues).toHaveLength(2)
    expect(issues[0]).toMatch(/^question 2:/)
  })
})
