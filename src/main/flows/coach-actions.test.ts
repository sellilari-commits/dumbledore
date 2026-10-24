import { createEngineBus } from '@engine/events'
import { describe, expect, it, vi } from 'vitest'
import { CoachActions, type CoachActionsDeps } from './coach-actions'

function setup(withAdjust = true) {
  const run = vi.fn(async () => ({ kind: 'wait', reason: 'ok' }) as never)
  const write = vi.fn()
  const deps = {
    sessions: { start: vi.fn() },
    quizzes: {},
    settings: {},
    bus: createEngineBus(),
    writer: { write },
    surfaces: {},
    overlay: { openQuiz: vi.fn() },
    roadmapAdjust: withAdjust ? { run } : undefined,
  } as unknown as CoachActionsDeps
  return { actions: new CoachActions(deps), run, write }
}

describe('CoachActions: adjust_roadmap', () => {
  it('hands the wish to RoadmapAdjust and pastes nothing', async () => {
    const t = setup()
    const action = {
      type: 'adjust_roadmap',
      subjectId: 'sub_chem',
      instruction: 'SN1 only',
    } as const
    await t.actions.run(action)
    expect(t.run).toHaveBeenCalledWith(action)
    expect(t.write).not.toHaveBeenCalled()
  })

  it('fails clearly when roadmap changes are not wired', async () => {
    const t = setup(false)
    await expect(
      t.actions.run({ type: 'adjust_roadmap', subjectId: 'sub_chem', instruction: 'x' }),
    ).rejects.toThrow(/not available/)
  })
})
