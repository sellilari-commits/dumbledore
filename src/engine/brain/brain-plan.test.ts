import {
  BrainTimeoutError,
  type RoadmapInput,
  RoadmapPlan,
  type StepInput,
} from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { systemClock } from '../clock'
import { brainHarness, R } from './testing/harness'

const roadmapInput = (over: Partial<RoadmapInput> = {}): RoadmapInput => ({
  goal: 'Understand SN1 vs SN2',
  subject: { id: 's1', name: 'Organic Chemistry' },
  deadline: '2026-12-12',
  minutesAvailable: 60,
  assistant: 'ChatGPT',
  language: 'en',
  profile: 'First-year chemistry student',
  mastery: [{ concept: 'Nucleophiles', status: 'mastered', evidence: 'passed 2 checkpoints' }],
  encounters: [{ seen: 'Rate = k[R–X]', bigPicture: 'SN1 kinetics', understanding: 'struggling' }],
  openQuestions: ['Why are tertiary carbocations stable?'],
  doneSteps: [],
  carry: ['Carbocation stability'],
  ...over,
})
const brevity =
  'No greetings or small talk. Short structured bullets, max ~150 words, bold key terms.'
const learn = (title: string, concept: string, move = 'intuition') => ({
  kind: 'learn',
  title,
  objective: `Can explain ${concept}`,
  concepts: [concept],
  move,
  promptDraft: `Hi! I'm a first-year chemistry student and I know nucleophiles. Explain ${concept}:\n1. the idea\n2. one example\nThen ask me one question to check I got it, and wait.`,
})
const plan = (items: unknown[]) => ({
  title: 'SN1 vs SN2',
  goal: 'Understand SN1 vs SN2',
  startReason: 'You know nucleophiles; carbocations tripped you up, so we start there.',
  offerPlacement: true,
  estimatedMinutes: 0,
  items,
  nextMilestone: '',
})

describe('Brain.buildRoadmap', () => {
  it('prompts with the tagged memory and the student-prompt rules', async () => {
    const h = brainHarness()
    h.groq.queue({ json: plan([learn('Carbocations', 'Carbocation stability', 'predict')]) })
    await h.brain.buildRoadmap(roadmapInput())
    const req = h.groq.requests[0]
    expect(req?.system).toContain('ChatGPT')
    expect(req?.system).toContain(brevity)
    expect(req?.system).toContain(
      'Write titles, objectives, startReason and prompt drafts in English',
    )
    const user = h.userOf(h.groq)
    for (const s of [
      '<goal>',
      'Nucleophiles — mastered',
      '[struggling] seen: Rate',
      '<carry>\n- Carbocation stability',
    ]) {
      expect(user).toContain(s)
    }
    expect(req?.reasoningEffort).toBe('medium')
  })

  it('enforces checkpoint spacing, a final checkpoint and carried concepts', async () => {
    const h = brainHarness()
    const items = [
      learn('A', 'Leaving groups'),
      learn('B', 'Carbocation stability'),
      learn('C', 'SN1 mechanism', 'predict'),
      learn('D', 'SN2 mechanism'),
      learn('E', 'SN1 vs SN2', 'explain_back'),
    ]
    h.groq.queue({ json: plan(items) })
    const out = await h.brain.buildRoadmap(roadmapInput())
    expect(RoadmapPlan.safeParse(out).success).toBe(true)
    const kinds = out.items.map((i) => i.kind)
    expect(kinds).toEqual(['learn', 'learn', 'learn', 'checkpoint', 'learn', 'learn', 'checkpoint'])
    const first = out.items[3]
    if (first?.kind !== 'checkpoint') throw new Error('expected checkpoint')
    expect(first.covers).toContain('Carbocation stability')
    expect(first.nQuestions).toBe(4) // 3 + 1 carried
    expect(first.probes.some((p) => p.concept === 'Carbocation stability')).toBe(true)
    expect(out.offerPlacement).toBe(false) // there is evidence
    expect(out.estimatedMinutes).toBe(5 * 5 + 2 * 3)
    expect(out.nextMilestone).toBeNull()
  })

  it('tidies prompt drafts: no greeting, brevity rule present', async () => {
    const h = brainHarness()
    h.groq.queue({ json: plan([learn('A', 'Leaving groups', 'predict')]) })
    const out = await h.brain.buildRoadmap(roadmapInput({ carry: [] }))
    const step = out.items[0]
    if (step?.kind !== 'learn') throw new Error('expected learn')
    expect(step.promptDraft.startsWith('Hi')).toBe(false)
    expect(step.promptDraft).toContain(brevity)
  })

  it('offers placement only without any evidence', async () => {
    const h = brainHarness()
    h.groq.queue({ json: { ...plan([learn('A', 'Basics', 'predict')]), offerPlacement: false } })
    const out = await h.brain.buildRoadmap(
      roadmapInput({ mastery: [], encounters: [], doneSteps: [], carry: [], openQuestions: [] }),
    )
    expect(out.offerPlacement).toBe(true)
  })

  it('repairs a roadmap without learn steps', async () => {
    const h = brainHarness()
    h.groq.queue(
      { json: plan([{ kind: 'checkpoint', covers: ['x'], probes: [], nQuestions: 3 }]) },
      { json: plan([learn('A', 'Basics', 'explain_back')]) },
    )
    const out = await h.brain.buildRoadmap(roadmapInput({ carry: [] }))
    expect(out.items[0]?.kind).toBe('learn')
    expect(h.groq.requests[1]?.messages.at(-1)?.content).toContain('at least one learn step')
  })

  it('writes Finnish drafts for Finnish goals', async () => {
    const h = brainHarness([R.ovh])
    h.ovh.queue({ json: plan([learn('A', 'Fotosynteesi', 'predict')]) })
    await h.brain.buildRoadmap(
      roadmapInput({
        language: 'auto',
        goal: 'Haluan ymmärtää miten fotosynteesi toimii ja mitä se tarkoittaa',
        encounters: [],
        mastery: [],
        carry: [],
      }),
    )
    expect(h.ovh.requests[0]?.system).toContain('in Finnish')
    expect(h.ovh.requests[0]?.system).toContain('Ei tervehdyksiä')
  })
})

const stepInput = (over: Partial<StepInput> = {}): StepInput => ({
  assistant: 'ChatGPT',
  language: 'en',
  profile: 'First-year chemistry student',
  step: {
    title: 'Carbocation stability',
    objective: 'Can explain why tertiary carbocations are most stable',
    move: 'intuition',
    promptDraft: "I'm a first-year chemistry student. Explain carbocation stability in 3 points.",
  },
  chatExcerpt: '[R] what is a carbocation\n[L] A carbocation is a positively charged carbon…',
  recentMisses: [
    { concept: 'Carbocation stability', misconception: 'Primary carbocations are most stable' },
  ],
  ...over,
})

describe('Brain.writeStep', () => {
  it('maps step, chat and misses into the prompt; tidies the output', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        prompt:
          "Hello!\nI'm a first-year chemistry student. I thought primary carbocations are most stable — explain why that's wrong.\n1. Why\n2. Example",
        coachTip:
          'Naming your misconception makes the answer target exactly what you got wrong, which is the fastest way to fix it for good.',
        memoryUpdates: [
          {
            type: 'understanding',
            concept: 'Carbocations',
            value: 'unclear',
            evidence: 'asked what a carbocation is',
          },
          { type: 'understanding', concept: 'X', value: 'confused', evidence: 'bad status' },
          {
            type: 'question',
            concept: 'Hyperconjugation',
            value: 'How does it stabilise?',
            evidence: '',
          },
        ],
      },
    })
    const out = await h.brain.writeStep(stepInput())
    const user = h.userOf(h.groq)
    expect(user).toContain('<step title="Carbocation stability" move="intuition">')
    expect(user).toContain('[R] what is a carbocation')
    expect(user).toContain('Carbocation stability: Primary carbocations are most stable')
    expect(out.prompt.startsWith('Hello')).toBe(false)
    expect(out.prompt).toContain('No greetings or small talk')
    expect(out.coachTip.split(/\s+/).length).toBeLessThanOrEqual(26)
    expect(out.memoryUpdates.map((m) => m.concept)).toEqual(['Carbocations', 'Hyperconjugation'])
  })

  it('times out after 2.5 s by default so the caller can use the draft', async () => {
    const h = brainHarness([R.groq], { clock: systemClock })
    h.groq.queue({ json: { prompt: 'x', coachTip: 'y', memoryUpdates: [] }, delayMs: 5000 })
    const started = Date.now()
    const err = await h.brain.writeStep(stepInput()).catch((e) => e)
    expect(err).toBeInstanceOf(BrainTimeoutError)
    const took = Date.now() - started
    expect(took).toBeGreaterThanOrEqual(2400)
    expect(took).toBeLessThan(3500)
  }, 10_000)
})
