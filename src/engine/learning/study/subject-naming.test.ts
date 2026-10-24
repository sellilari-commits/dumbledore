import { describe, expect, it } from 'vitest'
import type { RoadmapPlan } from '../../brain-contract'
import { FakeClock } from '../../clock'
import { createMemoryRepos } from '../../testing/memory-repos'
import { detectField } from './subject-naming'
import { deriveSubjectName, resolveSubject } from './subject-resolver'
import { chat, createHarness, ORGO_PLAN, seedSubject } from './test-helpers'

describe('subject names for a cold start (real-run fix)', () => {
  it.each([
    ['How do SN1 and SN2 reactions differ?', 'Organic Chemistry', '🧪'],
    ["I don't get the Calvin cycle", 'Biology', '🧬'],
    ['What is a derivative?', 'Calculus', '📐'],
    ['help me understand eigenvalues', 'Linear Algebra', '📐'],
    ['Hey, explain recursion, please', 'Computer Science', '💻'],
    ['How does supply and demand set prices?', 'Economics', '📈'],
    ['Why did the Roman Empire fall?', 'History', '🏛️'],
    ['What is a p-value really?', 'Statistics', '📊'],
    ['I want to learn underwater basket weaving', 'Underwater basket weaving', '📘'],
  ])('%s → %s %s', (text, name, emoji) => {
    const repos = createMemoryRepos(new FakeClock())
    const { subject, created } = resolveSubject(repos, text)
    expect(created).toBe(true)
    expect(subject).toMatchObject({ name, emoji, status: 'active' })
  })

  it.each([
    ['How do SN1 and SN2 reactions differ?', 'SN1 and SN2 reactions'],
    ["What's the difference between mitosis and meiosis?", 'Mitosis and meiosis'],
    ['Explain the key differences between SN1 and SN2', 'SN1 and SN2'],
  ])('topic name: %s → %s', (text, name) => {
    expect(deriveSubjectName(text)).toBe(name)
  })

  it('files a field question under the subject the student already has for it', () => {
    const repos = createMemoryRepos(new FakeClock())
    const chem = repos.subjects.create({ name: 'Chemistry', status: 'suggested' })
    const out = resolveSubject(repos, 'How do SN1 and SN2 reactions differ?')
    expect(out).toMatchObject({ created: false, subject: { id: chem.id, status: 'active' } })
  })

  it('reads the field from what the roadmapper wrote ("I am studying organic chemistry")', () => {
    expect(
      detectField(['Mechanisms 101', 'I am studying organic chemistry and need to …']),
    ).toMatchObject({ name: 'Organic Chemistry' })
    expect(detectField(['Underwater basket weaving'])).toBeNull()
    expect(detectField(['general knowledge about genetics'])?.name).not.toBe('Biology')
  })
})

describe('StudyService names a topic-named subject from the plan', () => {
  const plan = (): RoadmapPlan => ({
    ...structuredClone(ORGO_PLAN),
    title: 'Mechanisms, step by step',
    items: ORGO_PLAN.items.map((i) =>
      i.kind === 'learn'
        ? { ...i, promptDraft: `I am studying organic chemistry. ${i.promptDraft}` }
        : i,
    ),
  })

  it('renames the new subject to its field after planning', async () => {
    const h = createHarness({ brain: { buildRoadmap: async () => plan() } })
    await h.service.start(
      { subjectId: null, goal: 'Why do some reactions invert configuration?', question: null },
      chat(),
    )
    const session = h.service.current()
    expect(h.repos.subjects.get(session?.subjectId ?? '')).toMatchObject({
      name: 'Organic Chemistry',
      emoji: '🧪',
    })
  })

  it('folds it into the field subject the student already has', async () => {
    const h = createHarness({ brain: { buildRoadmap: async () => plan() } })
    const orgo = seedSubject(h.repos, 'Organic Chemistry', { emoji: '🧪' })
    await h.service.start(
      { subjectId: null, goal: 'Why do some reactions invert configuration?', question: null },
      chat(),
    )
    expect(h.service.current()?.subjectId).toBe(orgo.id)
    expect(h.repos.subjects.list()).toHaveLength(1)
    expect(h.repos.roadmaps.listBySubject(orgo.id)).toHaveLength(1)
  })
})
