import type { ConsolidateInput, RoadmapInput } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { type LlmRoadmap, orderIssues, roadmapPrompt, skipIssues } from './prompts/p03-roadmap'
import { buildConsolidateUser, finalizeConsolidate } from './prompts/p13-consolidate'
import { brainHarness } from './testing/harness'

const input: ConsolidateInput = {
  subject: { id: 'sub_c', name: 'Chemistry', goal: 'Pass the midterm' },
  language: 'en',
  concepts: [
    { id: 'con_s', name: 'Substitution', parentId: null, summary: '', status: 'new', mastery: 0 },
    {
      id: 'con_1',
      name: 'SN1',
      parentId: 'con_s',
      summary: 'Two steps.',
      status: 'learning',
      mastery: 0.4,
    },
  ],
  notes: [
    { id: 'not_a', conceptId: 'con_1', kind: 'fact', text: 'Tertiary favours SN1', pinned: false },
    { id: 'not_b', conceptId: null, kind: 'highlight', text: 'carbocation first', pinned: true },
  ],
  edges: [{ fromId: 'con_s', toId: 'con_1' }],
}

describe('P13 consolidation prompt', () => {
  it('lists the tree, notes and edges with short refs', () => {
    expect(buildConsolidateUser(input)).toBe(
      [
        '<subject>',
        'Chemistry · goal: Pass the midterm',
        '</subject>',
        '<concepts>',
        'c1 Substitution [new 0.00] < -',
        'c2 SN1 [learning 0.40] < c1',
        '   summary: Two steps.',
        '</concepts>',
        '<notes>',
        'n1 c2 fact: Tertiary favours SN1',
        'n2 - highlight [pinned]: carbocation first',
        '</notes>',
        '<edges>',
        'c1 → c2',
        '</edges>',
        '<other_subjects>',
        '(none)',
        '</other_subjects>',
      ].join('\n'),
    )
  })

  it('maps refs back to ids and passes unknown ones through for validation', () => {
    const out = finalizeConsolidate(
      {
        summaries: [
          { concept: 'c2', summary: ' SN1 goes via a carbocation. ' },
          { concept: 'c1', summary: '  ' },
        ],
        mergeConcepts: [{ from: 'c9', into: 'c2' }],
        mergeNotes: [{ from: 'n2', into: 'n1', text: '' }],
        topics: [{ concept: null, name: ' Mechanisms ', children: ['c2'] }],
        placeNotes: [{ note: 'n2', concept: 'c2' }],
        edges: [{ from: 'c1', to: 'c2', why: ' needs it ' }],
        openQuestions: [{ concept: 'c2', question: 'Why tertiary?' }],
      },
      input,
    )
    expect(out).toEqual({
      summaries: [{ conceptId: 'con_1', summary: 'SN1 goes via a carbocation.' }],
      mergeConcepts: [{ fromId: 'c9', intoId: 'con_1' }],
      mergeNotes: [{ fromId: 'not_b', intoId: 'not_a', text: null }],
      topics: [{ conceptId: null, name: 'Mechanisms', children: ['con_1'] }],
      placeNotes: [{ noteId: 'not_b', conceptId: 'con_1' }],
      edges: [{ fromId: 'con_s', toId: 'con_1', why: 'needs it' }],
      openQuestions: [{ conceptId: 'con_1', question: 'Why tertiary?' }],
      moveConcepts: [],
    })
  })

  it("shows each note's source and the other subjects, and maps moves back to ids", () => {
    const withSources: ConsolidateInput = {
      ...input,
      notes: [
        { ...(input.notes[0] as ConsolidateInput['notes'][number]), source: 'SN1 - Wikipedia' },
        input.notes[1] as ConsolidateInput['notes'][number],
      ],
      otherSubjects: [
        { id: 'sub_b', name: 'Biology' },
        { id: 'sub_p', name: 'Physics' },
      ],
    }
    const user = buildConsolidateUser(withSources)
    expect(user).toContain(
      '<notes>\nn1 c2 fact: Tertiary favours SN1 {SN1 - Wikipedia}\nn2 - highlight [pinned]: carbocation first\n</notes>',
    )
    expect(user).toContain('<other_subjects>\ns1 Biology\ns2 Physics\n</other_subjects>')
    const out = finalizeConsolidate(
      {
        summaries: [],
        mergeConcepts: [],
        mergeNotes: [],
        topics: [],
        placeNotes: [],
        edges: [],
        openQuestions: [],
        moveConcepts: [
          { concept: 'c2', subject: 's2' },
          { concept: 'c1', subject: 's9' },
        ],
      },
      withSources,
    )
    expect(out.moveConcepts).toEqual([
      { conceptId: 'con_1', subjectId: 'sub_p' },
      { conceptId: 'con_s', subjectId: 's9' },
    ])
  })

  it('runs on the reason tier with the never-invent rules', async () => {
    const h = brainHarness()
    h.groq.queue({
      json: {
        summaries: [],
        mergeConcepts: [],
        mergeNotes: [],
        topics: [],
        placeNotes: [],
        edges: [],
        openQuestions: [],
      },
    })
    const out = await h.brain.consolidate(input)
    expect(out.summaries).toEqual([])
    const system = h.groq.requests[0]?.system ?? ''
    expect(system).toContain('3 to 9 broad topics')
    expect(system).toContain('Never merge a pinned note')
    expect(system).toContain('Never invent facts')
  })
})

describe('P3 with the subject structure', () => {
  const roadmap: RoadmapInput = {
    goal: 'SN1 vs SN2',
    subject: { id: 'sub_c', name: 'Chemistry' },
    deadline: null,
    minutesAvailable: null,
    assistant: 'ChatGPT',
    language: 'en',
    profile: '',
    mastery: [],
    encounters: [],
    openQuestions: [],
    doneSteps: [],
    carry: [],
    tree: [
      { id: 't', name: 'Substitution', parentId: null, status: 'new', mastery: 0, summary: '' },
      {
        id: 'cc',
        name: 'Carbocations',
        parentId: 't',
        status: 'learning',
        mastery: 0.3,
        summary: 'Positive carbon.',
      },
      { id: 's1', name: 'SN1', parentId: 't', status: 'new', mastery: 0, summary: '' },
    ],
    edges: [{ fromId: 'cc', toId: 's1' }],
    keyNotes: [{ conceptId: 'cc', text: 'Tertiary carbocations are the most stable' }],
    suggestedOrder: ['Carbocations', 'SN1'],
  }

  it('shows the tree, prerequisites, key notes and the order to follow', () => {
    const built = roadmapPrompt.build(roadmap, { onDevice: false, today: '2026-10-25 (Sunday)' })
    expect(built.user).toContain(
      '<tree>\n- Substitution [new 0.00]\n  - Carbocations [learning 0.30]: Positive carbon.\n  - SN1 [new 0.00]\n</tree>',
    )
    expect(built.user).toContain('Carbocations → SN1')
    expect(built.user).toContain('Carbocations: Tertiary carbocations are the most stable')
    expect(built.user).toContain('<suggested_order>\n1. Carbocations\n2. SN1\n</suggested_order>')
    expect(built.system).toContain('When <suggested_order> is given')
  })

  it('names the pages a concept was read in', () => {
    const withSources: RoadmapInput = {
      ...roadmap,
      tree: (roadmap.tree ?? []).map((c) =>
        c.id === 't' ? { ...c, sources: ['SN1 - Wikipedia', 'Khan Academy'] } : c,
      ),
    }
    const built = roadmapPrompt.build(withSources, {
      onDevice: false,
      today: '2026-10-25 (Sunday)',
    })
    expect(built.user).toContain(
      '<tree>\n- Substitution [new 0.00] (read in: SN1 - Wikipedia; Khan Academy)\n  - Carbocations [learning 0.30]: Positive carbon.\n',
    )
    expect(built.system).toContain('"read in" in <tree>')
  })

  it('asks for a repair when a step teaches a concept before an earlier one', () => {
    const step = (title: string, concepts: string[]) => ({
      kind: 'learn' as const,
      title,
      objective: 'x',
      concepts,
      move: 'intuition' as const,
      promptDraft: 'Explain it.',
    })
    const plan = (items: LlmRoadmap['items']): LlmRoadmap => ({
      title: 'T',
      goal: 'G',
      startReason: 'R',
      offerPlacement: false,
      estimatedMinutes: 10,
      items,
      nextMilestone: null,
    })
    expect(orderIssues(plan([step('a', ['carbocations']), step('b', ['SN1'])]), roadmap)).toEqual(
      [],
    )
    expect(orderIssues(plan([step('b', ['SN1']), step('a', ['Carbocations'])]), roadmap)).toEqual([
      'items.1: teaches "Carbocations" after "SN1"; follow <suggested_order>',
    ])
    expect(orderIssues(plan([step('x', ['Something else'])]), roadmap)).toEqual([])
  })

  it("shows the student's wishes and asks for a repair when a step teaches a skipped concept", () => {
    const withPrefs = {
      ...roadmap,
      preferences: { instruction: 'SN1, not SN2', focus: ['SN1'], skip: ['SN2'] },
    }
    const built = roadmapPrompt.build(withPrefs, { onDevice: false, today: '2026-10-25 (Sunday)' })
    expect(built.user).toContain(
      '<preferences>\nstudent said: SN1, not SN2\nfocus: SN1\nskip: SN2\n</preferences>',
    )
    expect(built.system).toContain('Never teach a concept listed under skip')
    const learn = (concepts: string[]) => ({
      kind: 'learn' as const,
      title: 't',
      objective: 'x',
      concepts,
      move: 'intuition' as const,
      promptDraft: 'Explain it.',
    })
    const plan = (items: LlmRoadmap['items']): LlmRoadmap => ({
      title: 'T',
      goal: 'G',
      startReason: 'R',
      offerPlacement: false,
      estimatedMinutes: 10,
      items,
      nextMilestone: null,
    })
    expect(skipIssues(plan([learn(['SN1']), learn(['sn2'])]), withPrefs)).toEqual([
      'items.1: teaches "sn2", which the student asked to skip',
    ])
    expect(skipIssues(plan([learn(['SN2'])]), roadmap)).toEqual([])
  })
})
