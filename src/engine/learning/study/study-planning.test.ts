import { describe, expect, it } from 'vitest'
import {
  BrainTimeoutError,
  type RoadmapInput,
  type RoadmapPlan,
  type StepInput,
} from '../../brain-contract'
import { MOVE_TIPS } from './step-writer'
import { chat, createHarness, deferred, flush, ORGO_PLAN, seedSubject } from './test-helpers'

const roadmapInputs = (h: ReturnType<typeof createHarness>) =>
  h.brain.calls.filter((c) => c.method === 'buildRoadmap').map((c) => c.input as RoadmapInput)

describe('StudyService — cold start from free text', () => {
  it('creates the subject and always builds a roadmap first, with a placement offer', async () => {
    const h = createHarness()
    const first = await h.service.start(
      { subjectId: null, goal: null, question: "I don't get the Calvin cycle" },
      chat({ assistant: null, chatExcerpt: '' }),
    )
    // Named after the field, not the topic (real-run fix): "Biology" 🧬.
    const subject = h.repos.subjects.findByName('Biology')
    expect(subject).toMatchObject({ status: 'active', emoji: '🧬' })
    const [input] = roadmapInputs(h)
    expect(input).toMatchObject({
      goal: "I don't get the Calvin cycle",
      subject: { id: subject?.id, name: 'Biology' },
      assistant: 'ChatGPT',
      mastery: [],
      encounters: [],
      doneSteps: [],
      carry: [],
    })
    const session = h.service.current()
    expect(session).toMatchObject({
      subjectId: subject?.id,
      offerPlacement: true,
      phase: 'step',
      assistant: null,
    })
    expect(first.kind).toBe('paste')
  })

  it('offers placement whenever there is no history, even if the plan says otherwise', async () => {
    const h = createHarness({
      brain: {
        buildRoadmap: async () => ({ ...structuredClone(ORGO_PLAN), offerPlacement: false }),
      },
    })
    await h.service.start({ subjectId: null, goal: 'Learn SN1 reactions', question: null }, chat())
    expect(h.service.current()?.offerPlacement).toBe(true)
  })

  it('reuses the subject that owns a concept named in the text and revives suggested subjects', async () => {
    const h = createHarness()
    const biology = seedSubject(h.repos, 'Biology', { status: 'suggested' })
    h.repos.concepts.upsert({ subjectId: biology.id, name: 'Calvin cycle' })
    await h.service.start(
      { subjectId: null, goal: 'Explain the Calvin cycle to me', question: null },
      chat(),
    )
    expect(h.repos.subjects.list()).toHaveLength(1)
    expect(h.repos.subjects.get(biology.id)?.status).toBe('active')
    expect(h.service.current()?.subjectId).toBe(biology.id)
    expect(roadmapInputs(h)[0]?.mastery.map((m) => m.concept)).toEqual(['Calvin cycle'])
  })

  it('falls back to the focus subject and refuses an empty request', async () => {
    const h = createHarness()
    await expect(
      h.service.start({ subjectId: null, goal: null, question: null }, chat()),
    ).rejects.toThrow(/Pick a subject/)
    const focus = seedSubject(h.repos, 'Linear Algebra')
    h.repos.settings.update({ focusSubjectId: focus.id })
    await h.service.start({ subjectId: null, goal: '  ', question: null }, chat())
    expect(roadmapInputs(h)[0]).toMatchObject({
      goal: 'Linear Algebra',
      subject: { name: 'Linear Algebra' },
    })
  })
})

describe('StudyService — planning', () => {
  it("says 'wait' while planning and shows the planning phase", async () => {
    const plan = deferred<RoadmapPlan>()
    const h = createHarness({ brain: { buildRoadmap: () => plan.promise } })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const starting = h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await flush()
    expect(h.service.current()).toMatchObject({
      phase: 'planning',
      subjectName: 'Organic Chemistry',
      total: 0,
      nextAction: 'none',
    })
    expect(await h.service.next(chat())).toEqual({ kind: 'wait', reason: 'Building your roadmap…' })
    expect(
      (await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())).kind,
    ).toBe('wait')
    plan.resolve(structuredClone(ORGO_PLAN))
    expect((await starting).kind).toBe('paste')
    expect(h.service.current()?.phase).toBe('step')
  })

  it('goes back to "available" when planning fails', async () => {
    const h = createHarness({
      brain: { buildRoadmap: async () => Promise.reject(new Error('all providers down')) },
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    await expect(
      h.service.start({ subjectId: subject.id, goal: null, question: null }, chat()),
    ).rejects.toThrow(/Couldn't build a roadmap: all providers down/)
    expect(h.service.current()).toBeNull()
    expect(h.repos.roadmaps.listBySubject(subject.id)).toHaveLength(0)
    expect(h.sessions.map((s) => s?.phase ?? null)).toEqual(['planning', null])
  })

  it('times planning out on the injected clock', async () => {
    const h = createHarness({ brain: { buildRoadmap: () => new Promise<RoadmapPlan>(() => {}) } })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const starting = h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await flush()
    h.clock.advance(30_000)
    await expect(starting).rejects.toThrow(/timed out/)
    expect(h.service.current()).toBeNull()
  })

  it('end() during planning discards the late roadmap', async () => {
    const plan = deferred<RoadmapPlan>()
    const h = createHarness({ brain: { buildRoadmap: () => plan.promise } })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const starting = h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await flush()
    h.service.end()
    plan.resolve(structuredClone(ORGO_PLAN))
    expect(await starting).toEqual({ kind: 'wait', reason: 'Cancelled.' })
    expect(h.service.current()).toBeNull()
    expect(h.repos.roadmaps.listBySubject(subject.id)).toHaveLength(0)
  })
})

describe('StudyService — step writer fallback', () => {
  it('pastes the draft when writeStep misses its 2.5 s deadline', async () => {
    const h = createHarness({
      brain: {
        buildRoadmap: async () => structuredClone(ORGO_PLAN),
        writeStep: () => new Promise(() => {}),
      },
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const starting = h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    await flush()
    h.clock.advance(2499)
    await flush()
    expect(
      h.service.current()?.items[0]?.kind === 'learn' && h.service.current()?.items[0],
    ).toMatchObject({ promptSent: null })
    h.clock.advance(1)
    const first = await starting
    const draft = ORGO_PLAN.items[0]?.kind === 'learn' ? ORGO_PLAN.items[0].promptDraft : ''
    expect(first).toMatchObject({ kind: 'paste', text: draft, coachTip: MOVE_TIPS.intuition })
    const item = h.service.current()?.items[0]
    expect(item?.kind === 'learn' && item.promptSent).toBe(draft)
    expect(h.clock.pendingTimers()).toBe(0)
  })

  it('falls back when the brain reports a timeout, and passes its deadline to the brain', async () => {
    let seen: { timeoutMs?: number; signal?: AbortSignal } | undefined
    const h = createHarness({
      brain: {
        buildRoadmap: async () => structuredClone(ORGO_PLAN),
        writeStep: async (_input: StepInput, opts) => {
          seen = opts
          throw new BrainTimeoutError('writeStep')
        },
      },
    })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    const first = await h.service.start(
      { subjectId: subject.id, goal: null, question: null },
      chat(),
    )
    expect(first).toMatchObject({ kind: 'paste', coachTip: MOVE_TIPS.intuition })
    expect(first.kind === 'paste' && first.text.startsWith('DRAFT-1')).toBe(true)
    expect(seen?.timeoutMs).toBe(2500)
    expect(seen?.signal).toBeInstanceOf(AbortSignal)
  })
})
