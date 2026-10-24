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
