/**
 * Coach context and chat roadmap chips: the coach sees each subject's id, topics and open
 * roadmaps (steps and progress), and the double-tap chat never offers to start a roadmap a
 * subject already has.
 */
import type { Brain, CoachEvent, CoachInput } from '@engine/brain-contract'
import { FakeClock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import { createQueryService } from '@engine/queries/query-service'
import { ManualClock } from '@engine/store/seed/manual-clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import type { CoachAction, Roadmap, RoadmapItem, SubjectSummary } from '@shared/domain'
import { describe, expect, it, vi } from 'vitest'
import { AskFlow, type AskFlowDeps } from './ask-flow'
import { chatRoadmapActions, coachContextText, roadmapProgress } from './context'

const NOW = '2026-10-25T07:20:00.000Z'

function item(
  idx: number,
  title: string,
  status: RoadmapItem['status'],
  kind: RoadmapItem['kind'] = 'learn',
): RoadmapItem {
  const base = { id: `item_${idx}`, idx, title, status }
  return kind === 'learn'
    ? {
        ...base,
        kind,
        objective: title,
        concepts: [],
        move: 'intuition',
        promptDraft: '',
        promptSent: null,
      }
    : { ...base, kind, covers: [], probes: [], nQuestions: 3, quizId: null, score: null }
}

function roadmap(
  id: string,
  subjectId: string,
  title: string,
  status: Roadmap['status'],
  items: RoadmapItem[],
  updatedAt = NOW,
): Roadmap {
  return {
    id,
    subjectId,
    title,
    goal: title,
    startReason: '',
    offerPlacement: false,
    estimatedMinutes: 60,
    status,
    items,
    carry: [],
    nextMilestone: null,
    createdAt: updatedAt,
    updatedAt,
  }
}

/** The state Ilari's chat ran against: a paused causal-inference roadmap at step 3 of 6. */
function world() {
  const repos = createMemoryRepos(new FakeClock(NOW))
  const stats = repos.subjects.create({ name: 'Statistics', status: 'active' })
  const ml = repos.subjects.create({ name: 'Machine Learning', status: 'active' })
  const empty = repos.subjects.create({ name: 'Chemistry', status: 'active' })
  for (const name of ['Causal Inference', 'Functional Noise Models'])
    repos.concepts.upsert({ subjectId: stats.id, name })
  repos.concepts.upsert({ subjectId: ml.id, name: 'Neural Networks' })
  repos.roadmaps.save(
    roadmap('rdm_causal', stats.id, 'Causal Inference and Functional Noise Models', 'paused', [
      item(0, 'Causal Inference vs. Association', 'done'),
      item(1, 'Additive vs. General Functional Noise', 'done'),
      item(2, 'Checkpoint 1 · 3 questions', 'current', 'checkpoint'),
      item(3, 'Heteroskedastic and Post-Nonlinear Models', 'todo'),
      item(4, 'Applications in Political Science and Economics', 'todo'),
      item(5, 'Checkpoint 2 · 3 questions', 'todo', 'checkpoint'),
    ]),
  )
  repos.roadmaps.save(
    roadmap('rdm_nn', ml.id, 'Foundations of Neural Networks', 'active', [
      item(0, 'Core Architecture of Neural Networks', 'current'),
      item(1, 'Artificial Neurons and Activation Functions', 'todo'),
    ]),
  )
  const context = () =>
    coachContextText({
      repos,
      queries: {
        subjects: () =>
          repos.subjects.list().map(
            (s) =>
              ({
                ...s,
                progress: 0,
                mastery: 0,
                dueReviews: 0,
                openQuestions: 0,
                studyMinutesWeek: 0,
                lastStudiedAt: null,
              }) as SubjectSummary,
          ),
      },
      study: { current: () => null },
      perception: { now: () => null, aiChat: () => null },
      nowIso: () => NOW,
    })
  return { repos, stats, ml, empty, context }
}

describe('coachContextText: roadmaps', () => {
  it('lists each subject with its id, topics and open roadmaps with steps and progress', () => {
    const { stats, ml, empty, context } = world()
    const text = context()
    expect(text).toContain(` Statistics [${stats.id}]: mastery 0%, 0 reviews due`)
    expect(text).toContain('  Topics: Causal Inference [')
    expect(text).toContain(
      '  Roadmap (paused): "Causal Inference and Functional Noise Models", step 3 of 6, 2 done. Steps:',
    )
    expect(text).toContain('    1. Causal Inference vs. Association (done)')
    expect(text).toContain('    3. Checkpoint 1 · 3 questions (now)')
    expect(text).toContain('    6. Checkpoint 2 · 3 questions\n')
    expect(text).toContain(`Machine Learning [${ml.id}]`)
    expect(text).toContain(
      '  Roadmap (active): "Foundations of Neural Networks", step 1 of 2, 0 done',
    )
    expect(text).toContain(`Chemistry [${empty.id}]: mastery 0%, 0 reviews due\n  No roadmap yet.`)
  })

  it('leaves out finished roadmaps', () => {
    const { repos, empty, context } = world()
    repos.roadmaps.save(
      roadmap('rdm_done', empty.id, 'Moles', 'done', [item(0, 'What a mole is', 'done')]),
    )
    expect(context()).not.toContain('Moles')
  })

  it('progress counts done steps and names the current one, else the first to do', () => {
    const r = roadmap('r', 's', 'T', 'paused', [item(0, 'a', 'done'), item(1, 'b', 'todo')])
    expect(roadmapProgress(r)).toBe('step 2 of 2, 1 done')
    expect(roadmapProgress({ ...r, items: [item(0, 'a', 'done')] })).toBe('1 steps, 1 done')
  })
})

describe('chatRoadmapActions', () => {
  const goal = 'deeply understand causal inference'

  it('turns start_roadmap for a subject with an open roadmap into open_subject', () => {
    const { repos, stats } = world()
    const open: CoachAction = { type: 'open_subject', subjectId: stats.id }
    // By id, by the subject's name in place of an id, by an invented id, and by the goal alone.
    for (const subjectId of [stats.id, 'Statistics', 'sub_01JH82Z8QGVR0D5GZ8P9Y819AB', null]) {
      expect(chatRoadmapActions(repos, [{ type: 'start_roadmap', subjectId, goal }])).toEqual([
        open,
      ])
    }
    expect(
      chatRoadmapActions(repos, [
        { type: 'start_roadmap', subjectId: stats.id, goal },
        { type: 'open_subject', subjectId: stats.id },
      ]),
    ).toEqual([open])
  })

  it('keeps start_roadmap when no roadmap covers it, with a real subject id or null', () => {
    const { repos, empty } = world()
    const start = (subjectId: string | null, g = 'SN1 reactions'): CoachAction => ({
      type: 'start_roadmap',
      subjectId,
      goal: g,
    })
    expect(chatRoadmapActions(repos, [start(empty.id)])).toEqual([start(empty.id)])
    expect(chatRoadmapActions(repos, [start('Chemistry')])).toEqual([start(empty.id)])
    expect(chatRoadmapActions(repos, [start('subject_stats', 'Rust lifetimes')])).toEqual([
      start(null, 'Rust lifetimes'),
    ])
    expect(chatRoadmapActions(repos, [start(null, 'Rust lifetimes')])).toEqual([
      start(null, 'Rust lifetimes'),
    ])
  })
})

/**
 * Regression: "i want to deeply understand causal inference" / "what are the steps in the read
 * map" / "didn't you just built that readmap" each got "Let's build a roadmap" and a Start
 * roadmap chip, although Statistics had a paused roadmap at step 3 of 6. The coach got subject
 * names without ids, no topics and no roadmaps, so it invented ids and kept offering a new one.
 */
describe('double-tap chat on a subject that has a roadmap (regression)', () => {
  function chat(turns: CoachAction[][]) {
    const w = world()
    const inputs: CoachInput[] = []
    let turn = 0
    const brain = {
      coach(input: CoachInput): AsyncIterable<CoachEvent> {
        inputs.push(input)
        const actions = turns[turn++] ?? []
        return (async function* () {
          yield { type: 'text', delta: 'Reply.' }
          for (const action of actions) yield { type: 'action', action }
          yield { type: 'done' }
        })()
      },
    }
    const flow = new AskFlow({
      brain: brain as unknown as Brain,
      repos: w.repos as Repos,
      perception: { aiChat: () => null },
      sessions: { start: vi.fn() },
      writer: { write: vi.fn() },
      thinking: { run: (_label: string, fn: () => Promise<unknown>) => fn() },
      overlay: { showToast: vi.fn() },
      contextText: w.context,
      runAction: vi.fn(),
    } as unknown as AskFlowDeps)
    return { ...w, flow, inputs }
  }

  it('the coach sees the roadmap and its steps, and every chip opens it instead', async () => {
    const goal = 'deeply understand causal inference'
    const { flow, inputs, stats } = chat([
      [{ type: 'start_roadmap', subjectId: null, goal }],
      [{ type: 'start_roadmap', subjectId: 'sub_01JH82Z8QGVR0D5GZ8P9Y819AB', goal }],
      [{ type: 'start_roadmap', subjectId: 'Statistics', goal }],
    ])
    const messages = [
      'i want to deeply understand causal inference',
      'what are the steps in the read map',
      "didn't you just built that readmap",
    ]
    for (const message of messages) {
      const result = await flow.submit(message)
      expect(result.actions).toEqual([{ type: 'open_subject', subjectId: stats.id }])
    }
    for (const input of inputs) {
      expect(input.context).toContain(`Statistics [${stats.id}]`)
      expect(input.context).toContain('Topics: Causal Inference [')
      expect(input.context).toContain(
        'Roadmap (paused): "Causal Inference and Functional Noise Models", step 3 of 6, 2 done',
      )
      expect(input.context).toContain('4. Heteroskedastic and Post-Nonlinear Models')
    }
  })
})

describe('coachContextText', () => {
  it('names today and lists subjects and their topics with ids, gaps first', () => {
    const clock = new ManualClock('2026-10-25T09:00:00.000Z')
    const repos = createMemoryRepos(clock)
    const chem = repos.subjects.create({ name: 'Chemistry' })
    repos.subjects.update(chem.id, { goal: 'Pass the midterm' })
    const moles = repos.concepts.upsert({ subjectId: chem.id, name: 'Moles' })
    const sn1 = repos.concepts.upsert({ subjectId: chem.id, name: 'SN1' })
    repos.concepts.update(sn1.id, { status: 'struggling' })
    const text = coachContextText({
      repos,
      queries: createQueryService({ repos, clock, greetingName: 'Olle' }),
      study: { current: () => null },
      perception: { now: () => null, aiChat: () => null },
      nowIso: () => clock.nowIso(),
    })
    expect(text).toMatch(/^Today: 2026-10-25 \(Sunday\)/)
    expect(text).toContain(`Chemistry [${chem.id}]`)
    expect(text).toContain('goal: Pass the midterm')
    expect(text).toContain(`Topics: SN1 [${sn1.id}] (gap), Moles [${moles.id}]`)
  })
})
