import type { Concept, Roadmap } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { HOUR_MS, MINUTE_MS } from './local-time'
import { type CandidateContext, gatherCandidates, type NudgeCandidate } from './nudge-candidates'
import { isValidNudgeText } from './nudge-text'
import { studentWorld } from './scheduler-fixtures'

function setup(start = '2026-10-24T12:00:00.000Z') {
  const w = studentWorld({ start })
  const chem = w.repos.subjects.create({ name: 'Organic Chemistry', emoji: '🧪' })
  const concept = (name: string, patch: Partial<Concept> = {}, subjectId = chem.id) => {
    const c = w.repos.concepts.upsert({ subjectId, name })
    return w.repos.concepts.update(c.id, patch)
  }
  const ctx = (patch: Partial<CandidateContext> = {}): CandidateContext => ({
    repos: w.repos,
    nowMs: w.clock.now(),
    lt: w.localTime,
    settings: w.repos.settings.get(),
    followUps: [],
    habitsToCoach: [],
    ...patch,
  })
  const kinds = (cs: NudgeCandidate[]) => cs.map((c) => c.kind)
  return { ...w, chem, concept, ctx, kinds }
}

const dueAt = '2026-10-24T04:00:00.000Z'

describe('nudge candidates', () => {
  it('has nothing to say in an empty world', () => {
    const s = setup()
    expect(gatherCandidates(s.ctx())).toEqual([])
  })

  it('offers one review for all due concepts', () => {
    const s = setup()
    const a = s.concept('SN1', { box: 1, nextReviewAt: '2026-10-23T04:00:00.000Z' })
    const b = s.concept('E1', {
      box: 2,
      nextReviewAt: dueAt,
      status: 'struggling',
      struggleCount: 1,
    })
    const c = s.concept('SN2', { box: 1, nextReviewAt: dueAt })
    s.concept('Later', { box: 2, nextReviewAt: '2026-10-30T04:00:00.000Z' })
    const [review, ...rest] = gatherCandidates(s.ctx())
    expect(rest).toEqual([])
    expect(review).toMatchObject({
      kind: 'review_due',
      dedupeKey: 'review:2026-10-24',
      action: { type: 'start_review', conceptIds: [a.id, b.id, c.id] },
      fallback: { title: '3 reviews due', body: '3-minute check on SN1 and 2 more?' },
      subjectId: s.chem.id,
    })
    expect(review?.value).toBeCloseTo(0.74)
  })

  it('nudges about a struggling concept that is not already due', () => {
    const s = setup()
    const tricky = s.concept('Carbocation stability', {
      status: 'struggling',
      struggleCount: 2,
      mastery: 0.3,
    })
    const [c] = gatherCandidates(s.ctx())
    expect(c).toMatchObject({
      kind: 'struggle',
      dedupeKey: `struggle:${tricky.id}:2026-10-24`,
      action: { type: 'start_review', conceptIds: [tricky.id] },
      fallback: {
        title: 'Carbocation stability still tricky?',
        body: 'It tripped you up twice. Try a 3-minute check?',
      },
    })
    expect(c?.value).toBeCloseTo(0.65)
  })

  it('stays silent about muted and archived subjects and favours the focus subject', () => {
    const s = setup()
    s.concept('SN1', { box: 1, nextReviewAt: dueAt })
    s.repos.subjects.update(s.chem.id, { focus: 'muted' })
    expect(gatherCandidates(s.ctx())).toEqual([])
    s.repos.subjects.update(s.chem.id, { focus: 'normal', status: 'archived' })
    expect(gatherCandidates(s.ctx())).toEqual([])
    s.repos.subjects.update(s.chem.id, { status: 'active', focus: 'focus' })
    expect(gatherCandidates(s.ctx())[0]?.value).toBeCloseTo(0.53 * 1.15)
    s.repos.subjects.update(s.chem.id, { focus: 'normal' })
    const other = s.repos.subjects.create({ name: 'Physics' })
    s.repos.settings.update({ focusSubjectId: other.id })
    expect(gatherCandidates(s.ctx())[0]?.value).toBeCloseTo(0.53 * 0.85)
  })

  it('raises subject and assignment deadlines at T−3 d and T−1 d', () => {
    const s = setup()
    s.repos.subjects.update(s.chem.id, { deadline: '2026-10-27' })
    let [c] = gatherCandidates(s.ctx())
    expect(c).toMatchObject({
      kind: 'deadline',
      dedupeKey: `deadline:subject:${s.chem.id}:T-3`,
      action: { type: 'create_exam', spec: { subjectIds: [s.chem.id], count: 10, focus: 'weak' } },
      fallback: { title: 'Organic Chemistry deadline in 3 days' },
    })
    s.repos.subjects.update(s.chem.id, { deadline: '2026-10-25T09:00:00.000Z' })
    ;[c] = gatherCandidates(s.ctx())
    expect(c).toMatchObject({
      dedupeKey: `deadline:subject:${s.chem.id}:T-1`,
      value: 0.95,
      action: { spec: { count: 5 } },
      fallback: { title: 'Organic Chemistry deadline tomorrow' },
    })
    s.repos.subjects.update(s.chem.id, { deadline: '2026-10-30' })
    expect(gatherCandidates(s.ctx())).toEqual([])

    const essay = s.repos.assignments.upsert({
      subjectId: null,
      title: 'Lab report',
      dueAt: '2026-10-25',
      source: 'screen',
    })
    s.repos.assignments.upsert({
      subjectId: s.chem.id,
      title: 'Problem set',
      dueAt: '2026-10-26',
      source: 'screen',
    })
    const found = gatherCandidates(s.ctx())
    expect(found.map((x) => [x.dedupeKey, x.action?.type])).toEqual([
      [`deadline:assignment:${essay.id}:T-1`, 'start_roadmap'],
      [expect.stringMatching(/:T-3$/), 'open_subject'],
    ])
  })

  it('follows up 30–60 min after a finished study session', () => {
    const s = setup()
    const sn1 = s.concept('SN1')
    const roadmap: Roadmap = {
      id: 'rdm_1',
      subjectId: s.chem.id,
      title: 'SN1 from the basics',
      goal: 'SN1',
      startReason: '',
      offerPlacement: false,
      estimatedMinutes: 20,
      status: 'done',
      items: [
        {
          kind: 'learn',
          id: 'itm_1',
          idx: 0,
          title: 'SN1',
          objective: '',
          concepts: ['SN1'],
          move: 'intuition',
          promptDraft: '',
          promptSent: null,
          status: 'done',
        },
        {
          kind: 'checkpoint',
          id: 'itm_2',
          idx: 1,
          title: 'Check',
          covers: ['SN1', 'Unknown idea'],
          probes: [],
          nQuestions: 3,
          quizId: null,
          score: 1,
          status: 'done',
        },
      ],
      carry: [],
      nextMilestone: null,
      createdAt: '2026-10-24T10:00:00.000Z',
      updatedAt: '2026-10-24T11:00:00.000Z',
    }
    s.repos.roadmaps.save(roadmap)
    const finished = s.clock.now() - 40 * MINUTE_MS
    const [c] = gatherCandidates(
      s.ctx({ followUps: [{ roadmapId: 'rdm_1', completedAt: finished }] }),
    )
    expect(c).toMatchObject({
      kind: 'session_followup',
      dedupeKey: 'followup:rdm_1',
      value: 0.85,
      action: { type: 'start_review', conceptIds: [sn1.id] },
    })
    expect(isValidNudgeText(c?.fallback.title ?? '', c?.fallback.body ?? '')).toBe(true)
    const early = s.ctx({
      followUps: [{ roadmapId: 'rdm_1', completedAt: s.clock.now() - 10 * MINUTE_MS }],
    })
    expect(gatherCandidates(early)).toEqual([])
    const late = s.ctx({
      followUps: [{ roadmapId: 'rdm_1', completedAt: s.clock.now() - 2 * HOUR_MS }],
    })
    expect(gatherCandidates(late)).toEqual([])
  })

  it('plans the morning when the student opted in and there is something to plan', () => {
    const s = setup('2026-10-24T08:00:00.000Z')
    expect(gatherCandidates(s.ctx())).toEqual([])
    s.concept('SN1', { box: 1, nextReviewAt: dueAt })
    s.repos.subjects.update(s.chem.id, { deadline: '2026-11-02' })
    const plan = gatherCandidates(s.ctx()).find((c) => c.kind === 'morning_plan')
    expect(plan).toMatchObject({
      dedupeKey: 'morning:2026-10-24',
      fallback: {
        body: '1 review due, Organic Chemistry deadline in 9 days. Start a 10-minute plan?',
      },
      action: { type: 'start_review' },
    })
    s.repos.settings.update({
      coaching: { ...s.repos.settings.get().coaching, morningPlan: false },
    })
    expect(s.kinds(gatherCandidates(s.ctx()))).not.toContain('morning_plan')
  })

  it('wraps up the evening with misses to fix', () => {
    const s = setup('2026-10-24T20:00:00.000Z')
    expect(gatherCandidates(s.ctx())).toEqual([])
    const sn1 = s.concept('SN1')
    const q = (id: string, correctIndex: number) => ({
      id,
      conceptName: 'SN1',
      conceptId: sn1.id,
      stem: id,
      options: ['a', 'b', 'c', 'd'],
      correctIndex,
      rationales: ['', '', '', ''],
      difficulty: 2,
      carriedFrom: null,
    })
    s.repos.quizzes.save({
      id: 'quz_1',
      kind: 'review',
      title: 'Review',
      subjectIds: [s.chem.id],
      roadmapId: null,
      roadmapItemId: null,
      status: 'done',
      questions: [q('qst_1', 0), q('qst_2', 1), q('qst_3', 2)],
      answers: [
        {
          questionId: 'qst_1',
          chosenIndex: 0,
          correct: true,
          answeredAt: '2026-10-24T18:00:00.000Z',
        },
        {
          questionId: 'qst_2',
          chosenIndex: 1,
          correct: true,
          answeredAt: '2026-10-24T18:00:00.000Z',
        },
        {
          questionId: 'qst_3',
          chosenIndex: 0,
          correct: false,
          answeredAt: '2026-10-24T18:00:00.000Z',
        },
      ],
      score: 0.67,
      createdAt: '2026-10-24T18:00:00.000Z',
      completedAt: '2026-10-24T18:05:00.000Z',
    })
    const wrap = gatherCandidates(s.ctx()).find((c) => c.kind === 'evening_wrap')
    expect(wrap).toMatchObject({
      dedupeKey: 'evening:2026-10-24',
      fallback: {
        title: "Today's wrap-up",
        body: '3 questions today, 67% right. Fix the 1 miss now?',
      },
      action: { type: 'start_review', conceptIds: [sn1.id] },
    })
    expect(isValidNudgeText(wrap?.fallback.title ?? '', wrap?.fallback.body ?? '')).toBe(true)
  })

  it('coaches prompting habits now and then', () => {
    const s = setup()
    s.repos.profile.update({
      habits: {
        promptsSeen: 10,
        withContext: 1,
        withStructure: 5,
        askedToBeQuizzed: 2,
        askedForExamples: 4,
      },
    })
    const [tip, ...rest] = gatherCandidates(
      s.ctx({ habitsToCoach: ['Give more context about your level'] }),
    )
    expect(rest).toEqual([])
    expect(tip).toMatchObject({
      kind: 'tip',
      dedupeKey: 'tip:context:2026-W43',
      value: 0.35,
      action: null,
    })
  })

  it('keeps every template short, with one call to action', () => {
    const s = setup('2026-10-24T08:30:00.000Z')
    s.repos.profile.update({
      habits: {
        promptsSeen: 20,
        withContext: 0,
        withStructure: 0,
        askedToBeQuizzed: 0,
        askedForExamples: 0,
      },
    })
    const long = 'Nucleophilic substitution reactions at saturated carbon centres'
    for (let i = 0; i < 9; i++) s.concept(`${long} ${i}`, { box: 1, nextReviewAt: dueAt })
    s.concept(`${long} hard`, { status: 'struggling', struggleCount: 7 })
    s.repos.subjects.update(s.chem.id, { name: `${long} and Friends`, deadline: '2026-10-26' })
    s.repos.assignments.upsert({
      subjectId: null,
      title: `${long} essay draft`,
      dueAt: '2026-10-25',
      source: 'x',
    })
    const all = gatherCandidates(s.ctx())
    expect(new Set(s.kinds(all))).toEqual(
      new Set(['review_due', 'struggle', 'deadline', 'morning_plan', 'tip']),
    )
    for (const c of all)
      expect(isValidNudgeText(c.fallback.title, c.fallback.body), c.fallback.body).toBe(true)
  })
})
