import type { CheckpointItem, LearnItem, Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import type { RoadmapPlan } from '../../brain-contract'
import { FakeClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { assembleRoadmapContext } from './context'
import { checkpointTitle, materializeRoadmap, questionsFor } from './materialize'
import {
  applyCheckpointOutcome,
  closeItem,
  completionSummary,
  currentIndex,
  recentMisses,
} from './roadmap-ops'
import { deriveSubjectName, resolveSubject } from './subject-resolver'
import { ORGO_PLAN, seedEncounter } from './test-helpers'

const NOW = '2026-10-24T09:00:00.000Z'
const make = (plan: RoadmapPlan = structuredClone(ORGO_PLAN), carry: string[] = []) =>
  materializeRoadmap({
    id: 'rdm_1',
    subjectId: 'sub_1',
    plan,
    carry,
    noHistory: false,
    nowIso: NOW,
  })

describe('materializeRoadmap', () => {
  it('assigns ids, idx, statuses and checkpoint titles', () => {
    const r = make()
    expect(r.items.map((i) => [i.idx, i.status])).toEqual([
      [0, 'current'],
      [1, 'todo'],
      [2, 'todo'],
      [3, 'todo'],
      [4, 'todo'],
    ])
    expect(new Set(r.items.map((i) => i.id)).size).toBe(5)
    expect(r.items.every((i) => i.id.startsWith('itm_'))).toBe(true)
    expect(r.items[2]).toMatchObject({
      kind: 'checkpoint',
      title: 'Checkpoint 1 · 3 questions',
      quizId: null,
      score: null,
    })
    expect(r.items[0]).toMatchObject({ kind: 'learn', promptSent: null })
    expect(r).toMatchObject({ status: 'active', carry: [], offerPlacement: false, createdAt: NOW })
    const blank = structuredClone(ORGO_PLAN)
    const first = blank.items[0]
    if (first?.kind === 'learn') first.promptDraft = '  '
    expect((make(blank).items[0] as LearnItem).promptDraft).toBe(
      'I\'m working on: Tell SN1 from SN2 reactions. Teach me "Leaving groups" so that I can explain what makes a good leaving group. Use 3 numbered points and one concrete example. No greetings or small talk; short structured bullets, max ~150 words, bold key terms. Then ask me one question to check I got it, and wait.',
    )
    expect(checkpointTitle(2, 1)).toBe('Checkpoint 2 · 1 question')
  })

  it('appends a final checkpoint covering the whole roadmap and clamps question counts', () => {
    const plan: RoadmapPlan = {
      ...structuredClone(ORGO_PLAN),
      items: [
        { kind: 'checkpoint', covers: ['Leaving groups'], probes: [], nQuestions: 9 },
        ...ORGO_PLAN.items.filter((i) => i.kind === 'learn'),
      ],
    }
    const r = make(plan, ['Nucleophiles'])
    const last = r.items.at(-1) as CheckpointItem
    expect(r.items).toHaveLength(5)
    expect(last).toMatchObject({
      kind: 'checkpoint',
      title: 'Checkpoint 2 · 4 questions',
      covers: ['Leaving groups', 'Carbocation stability', 'SN1 mechanism', 'Nucleophiles'],
      nQuestions: 4,
    })
    expect((r.items[0] as CheckpointItem).nQuestions).toBe(5)
    expect(r.carry).toEqual(['Nucleophiles'])
    expect(questionsFor(3, 4)).toBe(5)
  })
})

describe('roadmap ops', () => {
  it('closeItem advances and finishes the roadmap after the last item', () => {
    let r = make()
    for (let i = 0; i < 4; i++) r = closeItem(r, currentIndex(r), NOW)
    expect(currentIndex(r)).toBe(4)
    expect(r.status).toBe('active')
    r = closeItem(r, 4, NOW)
    expect(currentIndex(r)).toBe(-1)
    expect(r.status).toBe('done')
  })

  it('carries misses into the next checkpoint and drops re-passed concepts', () => {
    let r: Roadmap = { ...make(), carry: ['Nucleophiles'] }
    r = closeItem(closeItem(r, 0, NOW), 1, NOW)
    const cp1 = r.items[2] as CheckpointItem
    r = applyCheckpointOutcome(
      r,
      cp1.id,
      {
        quizId: 'quz_1',
        score: 0.5,
        missed: ['Carbocation stability'],
        passed: ['Leaving groups', 'Nucleophiles'],
        gaps: [{ concept: 'Carbocation stability', misconception: 'Primary is most stable' }],
      },
      NOW,
    )
    expect(r.carry).toEqual(['Carbocation stability'])
    expect(r.items[2]).toMatchObject({ status: 'done', score: 0.5, quizId: 'quz_1' })
    expect(r.items[3]?.status).toBe('current')
    expect(r.items[4]).toMatchObject({
      covers: ['SN1 mechanism', 'Carbocation stability'],
      nQuestions: 4,
      title: 'Checkpoint 2 · 4 questions',
      probes: [{ concept: 'Carbocation stability', misconception: 'Primary is most stable' }],
    })
    expect(recentMisses(r)).toEqual([
      { concept: 'Carbocation stability', misconception: 'Primary is most stable' },
    ])
  })

  it('gives carried concepts without a diagnosed misconception a generic probe', () => {
    const r: Roadmap = { ...make(), carry: ['Nucleophiles'] }
    expect(recentMisses(r)).toEqual([
      { concept: 'Nucleophiles', misconception: 'Got this wrong in the last checkpoint' },
    ])
    expect(recentMisses(make())).toEqual([])
  })

  it('summarises a finished roadmap', () => {
    let r = make()
    r = { ...r, carry: ['Carbocation stability'] }
    r.items = r.items.map((i) =>
      i.kind === 'checkpoint'
        ? { ...i, score: i.idx === 2 ? 0.5 : 1, status: 'done' }
        : ({ ...i, status: 'done' } as LearnItem),
    )
    expect(completionSummary(r)).toBe(
      "Roadmap complete: SN1 vs SN2. 3 steps, 2 checkpoints · 75% average. Still shaky: Carbocation stability — they'll come back in your reviews.",
    )
  })
})

describe('cold-start subject names', () => {
  it.each([
    ["I don't get the Calvin cycle", 'Calvin cycle'],
    ['How does photosynthesis work?', 'Photosynthesis'],
    ['I want to understand SN1 reactions for my orgo midterm', 'SN1 reactions'],
    ['What is a derivative?', 'Derivative'],
    ['help me understand eigenvalues', 'Eigenvalues'],
    ['Hey, explain recursion, please', 'Recursion'],
    ['Linear algebra', 'Linear algebra'],
  ])('%s → %s', (text, name) => {
    expect(deriveSubjectName(text)).toBe(name)
  })

  it('matches a subject named inside the text before creating one', () => {
    const repos = createMemoryRepos(new FakeClock())
    const orgo = repos.subjects.create({ name: 'Organic Chemistry', status: 'suggested' })
    const found = resolveSubject(repos, 'Quiz me on SN1 for Organic Chemistry')
    expect(found).toMatchObject({ created: false, subject: { id: orgo.id, status: 'active' } })
    const created = resolveSubject(repos, 'I want to learn Rust lifetimes')
    expect(created).toMatchObject({
      created: true,
      subject: { name: 'Rust lifetimes', status: 'active' },
    })
  })
})

describe('roadmap context assembly', () => {
  it('packs mastery with evidence, encounters, questions, done steps and carry', () => {
    const clock = new FakeClock(NOW)
    const repos = createMemoryRepos(clock)
    const subject = repos.subjects.create({ name: 'Organic Chemistry', deadline: '2026-12-12' })
    const c = repos.concepts.upsert({ subjectId: subject.id, name: 'SN2' })
    repos.concepts.update(c.id, {
      mastery: 0.9,
      status: 'mastered',
      struggleCount: 1,
      lastSeenAt: NOW,
    })
    for (let i = 0; i < 25; i++) seedEncounter(repos, subject.id, { openQuestions: [`Q${i}?`] })
    const old = make()
    repos.roadmaps.save({
      ...old,
      subjectId: subject.id,
      status: 'done',
      carry: ['Carbocation stability', 'SN2'],
      items: old.items.map((i) => (i.idx === 0 ? { ...i, status: 'done' } : i)),
    })
    repos.profile.update({ aboutMe: 'Chemistry undergrad', promptLanguage: 'fi' })

    const { input, carry, noHistory } = assembleRoadmapContext(repos, {
      subject,
      goal: 'Ace the midterm',
      assistant: 'Claude',
      question: 'Why is SN1 two steps?',
      nowIso: NOW,
    })
    expect(noHistory).toBe(false)
    expect(carry).toEqual(['Carbocation stability'])
    expect(input).toMatchObject({
      goal: 'Ace the midterm',
      deadline: '2026-12-12',
      assistant: 'Claude',
      language: 'fi',
      doneSteps: ['Leaving groups'],
      carry: ['Carbocation stability'],
    })
    expect(input.profile).toContain('Chemistry undergrad')
    expect(input.encounters).toHaveLength(20)
    expect(input.openQuestions[0]).toBe('Why is SN1 two steps?')
    expect(input.openQuestions).toHaveLength(10)
    expect(input.mastery).toEqual([
      {
        concept: 'SN2',
        status: 'mastered',
        evidence: 'mastery 0.90 · struggled 1× · last seen 2026-10-24',
      },
    ])
  })
})
