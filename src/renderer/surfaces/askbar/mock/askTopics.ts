/**
 * Mock topics for the Ask bar's topic chips: nine subjects with a few top-level concepts each (the
 * mini panel's topics, shared/topics.ts), enough that the chips wrap past the row's height and
 * scroll. "Equilibrium" is in two subjects, so its chips carry the subject's name.
 * `?topics=0` leaves them out (the plain chat).
 */
import type { Concept, SubjectSummary } from '@shared/domain'
import type { SessionState, SubjectDetail } from '@shared/state'

/** Each subject's top-level concepts, with how many hours ago each got new information. */
const SUBJECTS: Array<{
  id: string
  name: string
  emoji: string
  daysAgo: number | null
  concepts: Array<[string, number | null]>
}> = [
  {
    id: 'sub_chem',
    name: 'Organic chemistry',
    emoji: '🧪',
    daysAgo: 0,
    concepts: [
      ['Carbocation stability', 1],
      ['SN1 mechanism', 3],
      ['Equilibrium', 30],
    ],
  },
  {
    id: 'sub_calc',
    name: 'Calculus II',
    emoji: '📐',
    daysAgo: 1,
    concepts: [
      ['Integration by parts', 2],
      ['Taylor series', 26],
    ],
  },
  {
    id: 'sub_hist',
    name: 'Cold War history',
    emoji: '🌍',
    daysAgo: 2,
    concepts: [
      ['Cuban Missile Crisis', 5],
      ['Marshall Plan', 50],
    ],
  },
  {
    id: 'sub_algo',
    name: 'Algorithms',
    emoji: '🧮',
    daysAgo: 3,
    concepts: [
      ['Quicksort', 6],
      ['Dynamic programming', 70],
      ['Graph search', 75],
    ],
  },
  {
    id: 'sub_bio',
    name: 'Cell biology',
    emoji: '🧬',
    daysAgo: 5,
    concepts: [
      ['Mitosis', 8],
      ['Cell membrane', 120],
    ],
  },
  {
    id: 'sub_span',
    name: 'Spanish B1',
    emoji: '🗣️',
    daysAgo: 8,
    concepts: [
      ['Subjunctive mood', 12],
      ['Preterite vs imperfect', 190],
    ],
  },
  {
    id: 'sub_econ',
    name: 'Microeconomics',
    emoji: '📈',
    daysAgo: 13,
    concepts: [
      ['Elasticity', 20],
      ['Equilibrium', 300],
    ],
  },
  {
    id: 'sub_phys',
    name: 'Thermodynamics',
    emoji: '🔥',
    daysAgo: 21,
    concepts: [
      ['Entropy', 400],
      ['Heat engines', 500],
    ],
  },
  {
    id: 'sub_phil',
    name: 'Ethics',
    emoji: '⚖️',
    daysAgo: null,
    concepts: [['Utilitarianism', null]],
  },
]

const ago = (now: number, hours: number) => new Date(now - hours * 3_600_000).toISOString()

function summary(s: (typeof SUBJECTS)[number], now: number): SubjectSummary {
  return {
    id: s.id,
    name: s.name,
    emoji: s.emoji,
    color: 'default',
    description: '',
    goal: null,
    deadline: null,
    status: 'active',
    focus: 'normal',
    createdAt: ago(now, 40 * 24),
    updatedAt: ago(now, (s.daysAgo ?? 40) * 24),
    progress: 0.4,
    mastery: 0.5,
    dueReviews: 0,
    openQuestions: 0,
    studyMinutesWeek: 0,
    lastStudiedAt: s.daysAgo === null ? null : ago(now, s.daysAgo * 24),
  }
}

/** What `subjects.list` answers in the mock. */
export function demoSubjects(now = Date.now()): SubjectSummary[] {
  return SUBJECTS.map((s) => summary(s, now))
}

/** What `subjects.get` answers in the mock: the subject with its top-level concepts. */
export function demoSubject(id: string, now = Date.now()): SubjectDetail {
  const s = SUBJECTS.find((x) => x.id === id)
  if (!s) throw new Error('No such subject')
  const concepts: Concept[] = s.concepts.map(([name, hours], i) => ({
    id: `${s.id}_c${i}`,
    subjectId: s.id,
    parentId: null,
    name,
    summary: '',
    mastery: 0.5,
    box: 0,
    nextReviewAt: null,
    status: 'learning',
    struggleCount: 0,
    lastSeenAt: hours === null ? null : ago(now, hours),
  }))
  return {
    subject: summary(s, now),
    roadmap: null,
    concepts,
    encounters: [],
    exams: [],
    assignments: [],
  }
}

/** What `session.start` answers in the mock: the subject's roadmap, a step ready to paste. */
export function demoSession(subjectId: string): SessionState {
  const s = SUBJECTS.find((x) => x.id === subjectId)
  if (!s) throw new Error('No such subject')
  return {
    roadmapId: `road_${s.id}`,
    subjectId: s.id,
    subjectName: s.name,
    subjectEmoji: s.emoji,
    title: s.name,
    phase: 'step',
    index: 0,
    total: 0,
    items: [],
    nextAction: 'paste_next',
    assistant: 'ChatGPT',
    startReason: '',
    offerPlacement: false,
    error: null,
  }
}
