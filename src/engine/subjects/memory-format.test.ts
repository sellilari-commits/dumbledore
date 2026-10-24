import type { Concept, Encounter, Note, SubjectSummary } from '@shared/domain'
import { describe, expect, it } from 'vitest'
import { encounterInput, quiz } from '../store/conformance/fixtures'
import { formatMemoryFile } from './memory-format'

const subject: SubjectSummary = {
  id: 'sub_1',
  name: 'Organic Chemistry',
  emoji: '🧪',
  color: 'purple',
  description: '',
  goal: 'pass the midterm',
  deadline: '2026-12-12T09:00:00.000Z',
  status: 'active',
  focus: 'normal',
  createdAt: '2026-10-01T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
  progress: 0.5,
  mastery: 0.62,
  dueReviews: 1,
  openQuestions: 1,
  studyMinutesWeek: 6,
  lastStudiedAt: '2026-10-24T14:32:00.000Z',
}

const concept = (over: Partial<Concept>): Concept => ({
  id: 'con_x',
  subjectId: 'sub_1',
  parentId: null,
  name: 'x',
  summary: '',
  mastery: 0,
  box: 0,
  nextReviewAt: null,
  status: 'new',
  struggleCount: 0,
  lastSeenAt: null,
  ...over,
})

const concepts: Concept[] = [
  concept({ id: 'con_ns', name: 'Nucleophilic substitution' }),
  concept({
    id: 'con_sn1',
    parentId: 'con_ns',
    name: 'SN1',
    mastery: 0.45,
    status: 'learning',
    nextReviewAt: '2026-10-26T09:00:00.000Z',
    lastSeenAt: '2026-10-24T14:32:00.000Z',
  }),
  concept({
    id: 'con_sn2',
    parentId: 'con_ns',
    name: 'SN2',
    mastery: 0.9,
    status: 'mastered',
    lastSeenAt: '2026-10-20T09:00:00.000Z',
  }),
  concept({
    id: 'con_cs',
    name: 'Carbocation stability',
    mastery: 0.3,
    status: 'struggling',
    lastSeenAt: '2026-10-24T14:00:00.000Z',
  }),
]

const sn1: Encounter = {
  ...encounterInput({
    subjectId: 'sub_1',
    conceptId: 'con_sn1',
    seen: 'rate = k[R–X]; tertiary substrates favour SN1 because their carbocations are most stable.',
    bigPicture: 'working out when each mechanism happens, for the midterm.',
    topicPath: ['Organic Chemistry', 'Nucleophilic substitution', 'SN1 vs SN2'],
    understanding: 'struggling',
    evidence:
      're-read the stability paragraph 3×;\nasked ChatGPT "why are tertiary carbocations more stable".',
    openQuestions: ['How does hyperconjugation stabilise a carbocation?'],
    source: {
      app: 'Chrome',
      bundleId: 'com.google.Chrome',
      url: 'https://en.wikipedia.org/wiki/SN1_reaction',
      title: 'SN1 reaction',
    },
    dwellSeconds: 360,
  }),
  id: 'enc_1',
  inboxState: 'accepted',
  createdAt: '2026-10-24T14:32:00.000Z',
}

const checkpoint = quiz({
  kind: 'checkpoint',
  title: 'Checkpoint 1',
  questions: quiz().questions.map((q, i) => ({
    ...q,
    id: `qst_${i}`,
    conceptId: 'con_cs',
    conceptName: 'Carbocation stability',
  })),
  answers: [
    { questionId: 'qst_0', chosenIndex: 3, correct: false, answeredAt: '2026-10-24T10:00:00.000Z' },
    { questionId: 'qst_1', chosenIndex: 3, correct: false, answeredAt: '2026-10-24T10:01:00.000Z' },
  ],
})

describe('formatMemoryFile', () => {
  it('renders the PLAN §6.7 format', () => {
    const ignored: Encounter = { ...sn1, id: 'enc_2', inboxState: 'ignored', seen: 'memes' }
    const text = formatMemoryFile(
      { subject, concepts, encounters: [sn1, ignored], quizzes: [checkpoint] },
      { timeZone: 'UTC' },
    )
    expect(text).toBe(`# 🧪 Organic Chemistry
Goal: pass the midterm (2026-12-12) · Mastery 62% · Last studied 2026-10-24

## Concept map
- Nucleophilic substitution
  - SN1 — Learning (0.45) · review due 2026-10-26
  - SN2 — Mastered (0.90)
- Carbocation stability — Struggling (missed 2 of 2 in checkpoint 1)

## Encounters
### 2026-10-24 14:32 · Chrome · en.wikipedia.org/wiki/SN1_reaction · 6 min
- **Seen:** rate = k[R–X]; tertiary substrates favour SN1 because their carbocations are most stable.
- **Big picture:** Organic Chemistry › Nucleophilic substitution › SN1 vs SN2 — working out when each mechanism happens, for the midterm.
- **Understanding:** struggling — re-read the stability paragraph 3×; asked ChatGPT "why are tertiary carbocations more stable".
- **Open questions:** How does hyperconjugation stabilise a carbocation?
`)
  })

  it('lists notes under their concept and the unplaced ones under Other notes', () => {
    const note = (over: Partial<Note>): Note => ({
      id: 'not_1',
      subjectId: 'sub_1',
      conceptId: 'con_sn1',
      encounterId: null,
      kind: 'fact',
      text: 'Tertiary substrates favour SN1',
      keywords: [],
      source: { app: 'Chrome', bundleId: null, url: null, title: 'SN1 reaction' },
      status: 'active',
      mergedInto: null,
      pinned: false,
      createdAt: '2026-10-24T14:32:00.000Z',
      updatedAt: '2026-10-24T14:32:00.000Z',
      ...over,
    })
    const text = formatMemoryFile(
      {
        subject,
        concepts,
        encounters: [],
        quizzes: [checkpoint],
        notes: [
          note({}),
          note({ id: 'not_2', kind: 'highlight', text: 'the rate depends only on [R–X]' }),
          note({ id: 'not_3', conceptId: null, text: 'Midterm covers chapters 7–9' }),
        ],
      },
      { timeZone: 'UTC' },
    )
    expect(text).toContain(`  - SN1 — Learning (0.45) · review due 2026-10-26
    - “Tertiary substrates favour SN1” (SN1 reaction, 2026-10-24)
    - “the rate depends only on [R–X]” (highlighted, SN1 reaction, 2026-10-24)
  - SN2 — Mastered (0.90)`)
    expect(text).toContain(`## Other notes
- “Midterm covers chapters 7–9” (SN1 reaction, 2026-10-24)

## Encounters`)
  })

  it('uses the time zone, handles empty sections and caps long histories', () => {
    const many = Array.from({ length: 3 }, (_, i) => ({
      ...sn1,
      id: `enc_${i}`,
      openQuestions: [],
    }))
    const text = formatMemoryFile(
      {
        subject: { ...subject, goal: null, lastStudiedAt: null, status: 'archived' },
        concepts: [],
        encounters: many,
        quizzes: [],
      },
      { timeZone: 'Europe/Helsinki', maxEncounters: 2 },
    )
    expect(text).toContain(
      'Deadline: 2026-12-12 · Mastery 62% · Not studied yet · Status: archived',
    )
    expect(text).toContain('_No concepts yet._')
    expect(text).toContain('### 2026-10-24 17:32 · Chrome')
    expect(text).toContain('_…and 1 older encounters._')
    expect(text).not.toContain('Open questions')
    const empty = formatMemoryFile({ subject, concepts: [], encounters: [], quizzes: [] })
    expect(empty).toContain('_Nothing seen yet._')
  })
})
