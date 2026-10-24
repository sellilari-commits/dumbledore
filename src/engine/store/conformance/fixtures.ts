/** Builders for the repository conformance suite: minimal valid domain records with overrides. */
import type { Episode, Quiz, Roadmap } from '@shared/domain'
import type { FakeClock } from '../../clock'
import type { LlmCallRecord, Repos } from '../../contracts'

export interface ConformanceTarget {
  repos: Repos
  clock: FakeClock
}

/** Creates a fresh, empty Repos on the given clock; `cleanup` runs after each test. */
export type ReposFactory = (clock: FakeClock) => { repos: Repos; cleanup?: () => void }

export type EncounterInput = Parameters<Repos['encounters']['add']>[0]

export function encounterInput(over: Partial<EncounterInput> = {}): EncounterInput {
  return {
    subjectId: null,
    conceptId: null,
    episodeId: null,
    seen: 'SN1 rate depends only on the substrate',
    bigPicture: 'Working out when SN1 happens',
    topicPath: ['Organic Chemistry', 'Nucleophilic substitution', 'SN1'],
    understanding: 'unclear',
    evidence: '',
    openQuestions: [],
    keyTerms: ['carbocation'],
    source: {
      app: 'Chrome',
      bundleId: 'com.google.Chrome',
      url: 'https://example.org/sn1',
      title: 'SN1',
    },
    dwellSeconds: 120,
    ...over,
  }
}

export function episode(over: Partial<Episode> = {}): Episode {
  return {
    id: 'epi_1',
    bundleId: 'com.google.Chrome',
    app: 'Chrome',
    title: 'SN1 reaction – Wikipedia',
    url: 'https://en.wikipedia.org/wiki/SN1_reaction',
    kind: 'reading',
    aiProvider: null,
    startedAt: '2026-10-24T08:00:00.000Z',
    endedAt: '2026-10-24T08:06:00.000Z',
    dwellSeconds: 360,
    text: 'The SN1 reaction is a substitution reaction…',
    source: 'ax',
    signals: {
      readingWpm: 180,
      baselineWpm: 220,
      scrollBacks: 2,
      revisitsToday: 1,
      searches: ['sn1 vs sn2'],
      aiQuestions: [],
    },
    extracted: false,
    ...over,
  }
}

export function roadmap(subjectId: string, over: Partial<Roadmap> = {}): Roadmap {
  return {
    id: 'rdm_1',
    subjectId,
    title: 'SN1 vs SN2',
    goal: 'Know when each mechanism happens',
    startReason: 'You struggled with carbocations',
    offerPlacement: false,
    estimatedMinutes: 35,
    status: 'active',
    items: [
      {
        kind: 'learn',
        id: 'itm_1',
        idx: 0,
        title: 'Carbocation stability',
        objective: 'Rank carbocations by stability',
        concepts: ['Carbocation stability'],
        move: 'intuition',
        promptDraft: 'Explain carbocation stability to me…',
        promptSent: null,
        status: 'done',
      },
      {
        kind: 'checkpoint',
        id: 'itm_2',
        idx: 1,
        title: 'Checkpoint 1',
        covers: ['Carbocation stability'],
        probes: [{ concept: 'Carbocation stability', misconception: 'Primary is most stable' }],
        nQuestions: 3,
        quizId: null,
        score: null,
        status: 'todo',
      },
    ],
    carry: ['Hyperconjugation'],
    nextMilestone: 'Midterm',
    createdAt: '2026-10-24T09:00:00.000Z',
    updatedAt: '2026-10-24T09:00:00.000Z',
    ...over,
  }
}

export function quiz(over: Partial<Quiz> = {}): Quiz {
  const options = ['A', 'B', 'C', 'D']
  return {
    id: 'quz_1',
    kind: 'exam',
    title: 'Weak-spots exam',
    subjectIds: [],
    roadmapId: null,
    roadmapItemId: null,
    status: 'ready',
    questions: ['qst_1', 'qst_2'].map((id, i) => ({
      id,
      conceptName: 'SN1',
      conceptId: null,
      stem: `Question ${i + 1}?`,
      options,
      correctIndex: i,
      rationales: options.map((o) => `Because ${o}`),
      difficulty: 2,
      carriedFrom: null,
    })),
    answers: [],
    score: null,
    createdAt: '2026-10-24T09:00:00.000Z',
    completedAt: null,
    ...over,
  }
}

export function llmCall(over: Partial<LlmCallRecord> = {}): LlmCallRecord {
  return {
    at: '2026-10-24T09:00:00.000Z',
    provider: 'groq',
    model: 'openai/gpt-oss-20b',
    tier: 'write',
    task: 'step',
    tokensIn: 100,
    tokensOut: 50,
    latencyMs: 420,
    ok: true,
    error: null,
    ...over,
  }
}
