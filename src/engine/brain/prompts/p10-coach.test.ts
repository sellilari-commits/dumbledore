import { describe, expect, it } from 'vitest'
import { COACH_TOOLS, coachSystem, toCoachAction } from './p10-coach'

describe('P10 coach: adjust_roadmap', () => {
  it('is offered as a tool and maps to a CoachAction', () => {
    expect(COACH_TOOLS.map((t) => t.name)).toContain('adjust_roadmap')
    expect(
      toCoachAction('adjust_roadmap', { subjectId: 'sub_chem', instruction: 'SN1, not SN2' }),
    ).toEqual({ type: 'adjust_roadmap', subjectId: 'sub_chem', instruction: 'SN1, not SN2' })
    expect(toCoachAction('adjust_roadmap', { subjectId: 'sub_chem' })).toBeNull()
  })

  it('tells the model when to adjust a roadmap and that chat mode never inserts prompts', () => {
    const system = coachSystem({ profile: '', context: '', history: [], message: '' })
    expect(system).toMatch(/what to focus on or skip in a subject[^\n]*adjust_roadmap/)
    expect(system).toMatch(/"Mode: chat"[^\n]*never call insert_prompt/)
  })
})

describe('P10 saving tools', () => {
  it('maps a question and a course fact, keeping only a real YYYY-MM-DD date', () => {
    expect(
      toCoachAction('save_question', {
        text: "I don't get carbocations",
        conceptId: null,
        topic: 'Carbocations',
        subjectId: 'sub_chem',
        stuck: true,
      }),
    ).toEqual({
      type: 'save_question',
      text: "I don't get carbocations",
      conceptId: null,
      topic: 'Carbocations',
      subjectId: 'sub_chem',
      stuck: true,
    })
    const fact = (deadline: string) =>
      toCoachAction('update_subject', { subjectId: 'sub_chem', goal: null, deadline, scope: null })
    expect(fact('2026-12-12T00:00:00Z')).toMatchObject({ deadline: '2026-12-12' })
    expect(fact('12 December')).toMatchObject({ deadline: null })
  })

  it('a plan request carries the exam date, and the coach never asks for ids', () => {
    expect(
      toCoachAction('start_roadmap', {
        goal: 'SN1 vs SN2',
        subjectId: null,
        deadline: '2026-12-12',
      }),
    ).toEqual({
      type: 'start_roadmap',
      goal: 'SN1 vs SN2',
      subjectId: null,
      deadline: '2026-12-12',
    })
    expect(toCoachAction('start_roadmap', { goal: 'SN1', subjectId: null })).toMatchObject({
      deadline: null,
    })
    const system = coachSystem({ profile: '', context: '', history: [], message: '' })
    expect(system).toMatch(/Never ask the student for an id/)
  })

  it('tells the coach to save questions and course facts, and never to claim a save', () => {
    const system = coachSystem({ profile: '', context: '', history: [], message: '' })
    expect(system).toMatch(/don't get something[^\n]*save_question/)
    expect(system).toMatch(/exam or deadline date[^\n]*update_subject/)
    expect(system).toMatch(/never claim you saved something without calling the tool/)
  })
})
