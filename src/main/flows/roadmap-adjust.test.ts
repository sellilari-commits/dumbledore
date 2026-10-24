import type { Repos } from '@engine/contracts'
import { createEngineBus } from '@engine/events'
import type { Roadmap, Subject } from '@shared/domain'
import type { StartSessionInput, StepInstruction } from '@shared/state'
import { describe, expect, it, vi } from 'vitest'
import { adjustedGoal, RoadmapAdjust, type RoadmapAdjustDeps } from './roadmap-adjust'
import { Thinking } from './thinking'

const CHEM = { id: 'sub_chem', name: 'Chemistry', goal: 'Pass the midterm' } as Subject

function setup(opts: { roadmapGoal?: string | null; step?: StepInstruction } = {}) {
  const subjects = new Map([[CHEM.id, { ...CHEM }]])
  const update = vi.fn((id: string, patch: Partial<Subject>) => {
    const next = { ...(subjects.get(id) as Subject), ...patch }
    subjects.set(id, next)
    return next
  })
  const starts: StartSessionInput[] = []
  const step =
    opts.step ??
    ({ kind: 'paste', text: 'First step', coachTip: null, itemId: 'itm_1' } as StepInstruction)
  const pasteFailed = vi.fn()
  const bus = createEngineBus()
  const changes: unknown[] = []
  bus.on('memory:changed', (c) => changes.push(c))
  const deps: RoadmapAdjustDeps = {
    study: {
      start: vi.fn(async (input: StartSessionInput) => {
        starts.push(input)
        return step
      }),
      pasteFailed,
    },
    repos: {
      subjects: { get: (id: string) => subjects.get(id) ?? null, update },
      roadmaps: {
        getActive: () =>
          opts.roadmapGoal === null
            ? null
            : ({ goal: opts.roadmapGoal ?? 'SN1 and SN2' } as Roadmap),
      },
    } as unknown as Pick<Repos, 'subjects' | 'roadmaps'>,
    perception: { aiChat: () => null, chatExcerpt: () => '', pageContext: () => '' },
    thinking: new Thinking(bus),
    bus,
  }
  return { adjust: new RoadmapAdjust(deps), starts, update, pasteFailed, changes }
}

describe('RoadmapAdjust (adjust_roadmap from the double-tap chat)', () => {
  it('records the wish as the subject goal and replans without pasting', async () => {
    const t = setup()
    await t.adjust.run({
      type: 'adjust_roadmap',
      subjectId: CHEM.id,
      instruction: ' SN1, not SN2 ',
    })
    expect(t.update).toHaveBeenCalledWith(CHEM.id, { goal: 'SN1, not SN2' })
    expect(t.starts).toEqual([
      { subjectId: CHEM.id, goal: "SN1 and SN2. Student's wish: SN1, not SN2", question: null },
    ])
    expect(t.pasteFailed).toHaveBeenCalledWith('itm_1')
    expect(t.changes).toContainEqual({ scope: 'subjects', ids: [CHEM.id] })
  })

  it('falls back to the subject goal, then its name, when there is no roadmap', async () => {
    const t = setup({ roadmapGoal: null })
    await t.adjust.run({ type: 'adjust_roadmap', subjectId: CHEM.id, instruction: 'only kinetics' })
    expect(t.starts[0]?.goal).toBe("Pass the midterm. Student's wish: only kinetics")
  })

  it('leaves a quiz or wait instruction alone and refuses unknown subjects or empty wishes', async () => {
    const t = setup({ step: { kind: 'wait', reason: 'Busy' } as StepInstruction })
    await t.adjust.run({ type: 'adjust_roadmap', subjectId: CHEM.id, instruction: 'x' })
    expect(t.pasteFailed).not.toHaveBeenCalled()
    await expect(
      t.adjust.run({ type: 'adjust_roadmap', subjectId: 'sub_gone', instruction: 'x' }),
    ).rejects.toThrow(/no longer exists/)
    await expect(
      t.adjust.run({ type: 'adjust_roadmap', subjectId: CHEM.id, instruction: '  ' }),
    ).rejects.toThrow(/roadmap should cover/)
  })

  it('adjustedGoal does not repeat a wish that is the goal itself', () => {
    expect(adjustedGoal('SN1', 'sn1')).toBe('sn1')
    expect(adjustedGoal('', 'SN1')).toBe('SN1')
  })
})
