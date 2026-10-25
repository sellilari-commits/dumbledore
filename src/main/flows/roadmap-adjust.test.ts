import type { PreferencesInput, PreferencesOutput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import { createEngineBus } from '@engine/events'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { StartSessionInput, StepInstruction } from '@shared/state'
import { describe, expect, it, vi } from 'vitest'
import { RoadmapAdjust } from './roadmap-adjust'
import { Thinking } from './thinking'

const NOW = '2026-10-25T09:00:00.000Z'

function setup(
  opts: {
    roadmapGoal?: string | null
    step?: StepInstruction
    mapped?: (input: PreferencesInput) => PreferencesOutput
    failMapping?: boolean
  } = {},
) {
  const repos = createMemoryRepos()
  const chem = repos.subjects.create({ name: 'Chemistry', goal: 'Pass the midterm' })
  const sn1 = repos.concepts.upsert({ subjectId: chem.id, name: 'SN1' })
  const sn2 = repos.concepts.upsert({ subjectId: chem.id, name: 'SN2' })
  const starts: StartSessionInput[] = []
  const step =
    opts.step ??
    ({ kind: 'paste', text: 'First step', coachTip: null, itemId: 'itm_1' } as StepInstruction)
  const pasteFailed = vi.fn()
  const bus = createEngineBus()
  const changes: unknown[] = []
  bus.on('memory:changed', (c) => changes.push(c))
  const mapInputs: PreferencesInput[] = []
  const roadmaps = {
    ...repos.roadmaps,
    getActive: () =>
      opts.roadmapGoal === null
        ? null
        : ({ goal: opts.roadmapGoal ?? 'SN1 and SN2' } as ReturnType<
            Repos['roadmaps']['getActive']
          >),
  }
  const adjust = new RoadmapAdjust({
    study: {
      start: vi.fn(async (input: StartSessionInput) => {
        starts.push(input)
        return step
      }),
      pasteFailed,
    },
    repos: { ...repos, roadmaps } as Repos,
    brain: {
      mapPreferences: async (input) => {
        mapInputs.push(input)
        if (opts.failMapping) throw new Error('offline')
        return (
          opts.mapped?.(input) ?? {
            replace: false,
            focus: [sn1.id],
            skip: [sn2.id],
            focusNames: [],
            skipNames: [],
          }
        )
      },
    },
    perception: { aiChat: () => null, chatExcerpt: () => '', pageContext: () => '' },
    thinking: new Thinking(bus),
    bus,
    now: () => NOW,
  })
  return { adjust, repos, chem, sn1, sn2, starts, pasteFailed, changes, mapInputs }
}

describe('RoadmapAdjust (adjust_roadmap from the double-tap chat)', () => {
  it('stores the mapped wishes as study preferences and replans without pasting', async () => {
    const t = setup()
    await t.adjust.run({
      type: 'adjust_roadmap',
      subjectId: t.chem.id,
      instruction: ' SN1, not SN2 ',
    })
    expect(t.repos.subjects.studyPreferences(t.chem.id)).toEqual({
      instruction: 'SN1, not SN2',
      focus: [t.sn1.id],
      skip: [t.sn2.id],
      focusNames: [],
      skipNames: [],
      updatedAt: NOW,
    })
    // The subject's own goal is kept; the roadmap keeps its goal and gets the wishes structurally.
    expect(t.repos.subjects.get(t.chem.id)?.goal).toBe('Pass the midterm')
    // A fresh plan even though the goal is the open roadmap's; the old one goes to the history.
    expect(t.starts).toEqual([
      { subjectId: t.chem.id, goal: 'SN1 and SN2', question: null, replan: 'SN1, not SN2' },
    ])
    expect(t.pasteFailed).toHaveBeenCalledWith('itm_1')
    expect(t.changes).toContainEqual({ scope: 'subjects', ids: [t.chem.id] })
  })

  it('gives P14 the concept tree, the stored wishes and the new words', async () => {
    const t = setup()
    await t.adjust.run({ type: 'adjust_roadmap', subjectId: t.chem.id, instruction: 'SN1 only' })
    await t.adjust.run({
      type: 'adjust_roadmap',
      subjectId: t.chem.id,
      instruction: 'also kinetics',
    })
    expect(t.mapInputs[0]?.concepts.map((c) => c.name)).toEqual(['SN1', 'SN2'])
    expect(t.mapInputs[1]?.current).toEqual({ focus: [t.sn1.id], skip: [t.sn2.id] })
    expect(t.repos.subjects.studyPreferences(t.chem.id)?.instruction).toBe(
      'SN1 only · also kinetics',
    )
  })

  it('still stores the words and replans when the mapping call fails', async () => {
    const t = setup({ failMapping: true, roadmapGoal: null })
    await t.adjust.run({
      type: 'adjust_roadmap',
      subjectId: t.chem.id,
      instruction: 'only kinetics',
    })
    expect(t.repos.subjects.studyPreferences(t.chem.id)).toMatchObject({
      instruction: 'only kinetics',
      focus: [],
      skip: [],
    })
    expect(t.starts[0]?.goal).toBe('Pass the midterm')
  })

  it('leaves a quiz or wait instruction alone and refuses unknown subjects or empty wishes', async () => {
    const t = setup({ step: { kind: 'wait', reason: 'Busy' } as StepInstruction })
    await t.adjust.run({ type: 'adjust_roadmap', subjectId: t.chem.id, instruction: 'x' })
    expect(t.pasteFailed).not.toHaveBeenCalled()
    await expect(
      t.adjust.run({ type: 'adjust_roadmap', subjectId: 'sub_gone', instruction: 'x' }),
    ).rejects.toThrow(/no longer exists/)
    await expect(
      t.adjust.run({ type: 'adjust_roadmap', subjectId: t.chem.id, instruction: '  ' }),
    ).rejects.toThrow(/roadmap should cover/)
  })
})
