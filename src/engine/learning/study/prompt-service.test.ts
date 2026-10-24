import type { SessionState } from '@shared/state'
import { describe, expect, it } from 'vitest'
import type { ImproveInput, SuggestInput } from '../../brain-contract'
import { FakeClock } from '../../clock'
import type { Repos } from '../../contracts'
import { type BrainOverrides, FakeBrain } from '../../testing/fake-brain'
import { createMemoryRepos } from '../../testing/memory-repos'
import { buildCandidates } from './prompt-candidates'
import { PromptServiceImpl } from './prompt-service'
import {
  chat,
  createHarness,
  deferred,
  ORGO_PLAN,
  seedEncounter,
  seedSubject,
} from './test-helpers'

function setup(overrides: BrainOverrides = {}, session: () => SessionState | null = () => null) {
  const clock = new FakeClock('2026-10-24T09:00:00.000Z')
  const repos = createMemoryRepos(clock)
  const brain = new FakeBrain(overrides)
  const service = new PromptServiceImpl({ repos, brain, clock, session })
  return { clock, repos, brain, service }
}

function seedSignals(repos: Repos) {
  const orgo = seedSubject(repos, 'Organic Chemistry', { deadline: '2026-10-30' })
  const bio = seedSubject(repos, 'Biology')
  seedEncounter(repos, bio.id, { openQuestions: ['What does RuBisCO do'], keyTerms: ['RuBisCO'] })
  seedEncounter(repos, orgo.id, { openQuestions: ['Why is SN2 one step?'], keyTerms: ['SN2'] })
  const hard = repos.concepts.upsert({ subjectId: orgo.id, name: 'Carbocation stability' })
  repos.concepts.update(hard.id, { status: 'struggling', struggleCount: 2 })
  const due = repos.concepts.upsert({ subjectId: bio.id, name: 'Light reactions' })
  repos.concepts.update(due.id, { nextReviewAt: '2026-10-23T00:00:00.000Z' })
  return { orgo, bio }
}

describe('prompt candidates', () => {
  it('ranks open question › struggling › due review › deadline › starter; page matches first', () => {
    const { repos, clock } = setup()
    seedSignals(repos)
    repos.profile.update({ level: 'first-year university' })
    const candidates = buildCandidates({
      repos,
      session: null,
      pageContext: 'Photosynthesis — RuBisCO fixes CO2 in the Calvin cycle',
      nowIso: clock.nowIso(),
    })
    expect(candidates.map((c) => c.kind)).toEqual([
      'open_question',
      'open_question',
      'struggling',
      'due_review',
      'deadline',
      'starter',
    ])
    expect(candidates[0]?.text).toContain(
      "I'm studying Biology (first-year university). What does RuBisCO do?",
    )
    expect(candidates[0]?.text).toContain('No greetings or small talk')
    expect(candidates[2]?.text).toContain('I keep getting Carbocation stability wrong')
    expect(candidates[3]?.text).toContain('Light reactions')
    expect(candidates[4]?.text).toContain('2026-10-30 (6 days left)')
  })

  it('puts the session step first and always ends with a starter', () => {
    const { repos, clock } = setup()
    expect(
      buildCandidates({ repos, session: null, pageContext: '', nowIso: clock.nowIso() }),
    ).toEqual([
      expect.objectContaining({ kind: 'starter', text: expect.stringContaining('something new') }),
    ])
  })
})

describe('PromptService', () => {
  it('suggest: session next step first, written by the brain', async () => {
    const h = createHarness({ brain: { buildRoadmap: async () => structuredClone(ORGO_PLAN) } })
    const subject = seedSubject(h.repos, 'Organic Chemistry')
    await h.service.start({ subjectId: subject.id, goal: null, question: null }, chat())
    const prompts = new PromptServiceImpl({
      repos: h.repos,
      brain: h.brain,
      clock: h.clock,
      session: () => h.service.current(),
    })
    const out = await prompts.suggest(chat())
    const input = h.brain.calls.find((c) => c.method === 'suggestPrompt')?.input as SuggestInput
    expect(input.candidates[0]).toEqual({
      kind: 'session_step',
      text: expect.stringContaining('DRAFT-2'),
    })
    expect(input.context).toContain(
      'Study session: Organic Chemistry — SN1 vs SN2 (step 1 of 5: Leaving groups)',
    )
    expect(input.assistant).toBe('ChatGPT')
    expect(out.prompt).toContain('DRAFT-2')
    expect(out.coachTip).toBeTruthy()
  })

  it('suggest falls back to the top candidate as a plain prompt', async () => {
    const { repos, service } = setup({
      suggestPrompt: async () => Promise.reject(new Error('down')),
    })
    seedSignals(repos)
    const out = await service.suggest(chat({ pageContext: 'SN2 backside attack' }))
    expect(out.coachTip).toBeNull()
    expect(out.prompt).toContain('Why is SN2 one step?')
  })

  it('suggest falls back on timeout (FakeClock)', async () => {
    const hang = deferred<never>()
    const { clock, service } = setup({ suggestPrompt: () => hang.promise })
    const pending = service.suggest(chat())
    await new Promise((r) => setImmediate(r))
    clock.advance(2500)
    const out = await pending
    expect(out).toEqual({
      prompt: expect.stringContaining('Help me plan how to learn'),
      coachTip: null,
    })
  })

  it('improve sends the draft with profile and context', async () => {
    const { repos, brain, service } = setup()
    repos.profile.update({ aboutMe: 'Chemistry student', level: 'first-year' })
    const out = await service.improve(
      'what is osmosis',
      chat({ assistant: 'Claude', pageContext: 'Cell membranes' }),
    )
    const input = brain.calls.find((c) => c.method === 'improvePrompt')?.input as ImproveInput
    expect(input).toMatchObject({ assistant: 'Claude', draft: 'what is osmosis', language: 'auto' })
    expect(input.profile).toContain('Chemistry student')
    expect(input.context).toContain('On screen: Cell membranes')
    expect(out.prompt).toContain('what is osmosis')
    expect(out.coachTip).toMatch(/What I improved/)
  })

  it('improve returns the draft unchanged when the brain fails or times out', async () => {
    const failing = setup({ improvePrompt: async () => Promise.reject(new Error('429')) })
    expect(await failing.service.improve('  explain osmosis ', chat())).toEqual({
      prompt: '  explain osmosis ',
      coachTip: null,
    })
    const hang = deferred<never>()
    const slow = setup({ improvePrompt: () => hang.promise })
    const pending = slow.service.improve('explain osmosis', chat())
    await new Promise((r) => setImmediate(r))
    slow.clock.advance(2500)
    expect(await pending).toEqual({ prompt: 'explain osmosis', coachTip: null })
  })

  it('improve with an empty draft behaves like suggest', async () => {
    const { brain, service } = setup()
    await service.improve('   ', chat())
    expect(brain.calls.map((c) => c.method)).toEqual(['suggestPrompt'])
  })
})
