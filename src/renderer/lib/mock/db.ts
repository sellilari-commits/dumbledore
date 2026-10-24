/**
 * The mock API's in-memory database and its scenarios (demo, empty, onboarding). Read models
 * are derived from it in ./derive; handlers in ./handlers mutate it and emit events.
 */
import {
  type Assignment,
  type ChatMessage,
  type Concept,
  DEFAULT_SETTINGS,
  type Encounter,
  type Profile,
  type Quiz,
  type Roadmap,
  type Settings,
  type Subject,
} from '@shared/domain'
import type { AppState, SessionState, UsageSummary } from '@shared/state'
import { demoAppState, demoAssignments, demoChat, demoProfile, demoUsage, demoWeek } from './demo-misc'
import { demoEncounters } from './demo-encounters'
import { demoQuizzes } from './demo-quizzes'
import { demoConcepts, demoRoadmaps, demoSubjects } from './demo-subjects'

export type MockScenario = 'demo' | 'empty' | 'error' | 'slow' | 'onboarding'

export interface MockDb {
  settings: Settings
  appState: AppState
  profile: Profile
  subjects: Subject[]
  concepts: Concept[]
  encounters: Encounter[]
  assignments: Assignment[]
  roadmaps: Roadmap[]
  quizzes: Quiz[]
  chat: ChatMessage[]
  usage: UsageSummary
  /** Roadmap the study session runs on, or null when no session is active. */
  sessionRoadmapId: string | null
  /** Overrides the derived phase while a roadmap is "being planned". */
  sessionPhase: SessionState['phase'] | null
  weekMinutes: Record<string, number>
  questionsAnswered: number
  correct: number
  /** When a permission flips to granted after the user "opens System Settings". */
  grantAt: { accessibility: number | null; screenRecording: number | null }
}

export function createDb(scenario: MockScenario): MockDb {
  const onboarding = scenario === 'onboarding'
  const empty = scenario === 'empty' || onboarding
  const appState = demoAppState(!onboarding)
  if (empty) {
    appState.now = null
    appState.aiChat = null
    appState.focusSubjectId = null
  }
  const settings: Settings = {
    ...DEFAULT_SETTINGS,
    onboardingDone: !onboarding,
    focusSubjectId: empty ? null : 'sub_orgo',
    ai: { ...DEFAULT_SETTINGS.ai, groqKeySet: !onboarding },
    excludedHosts: empty ? [] : ['mybank.fi', 'web.whatsapp.com'],
    excludedBundleIds: empty ? [] : ['com.1password.1password'],
  }
  if (onboarding) appState.permissions = { accessibility: false, screenRecording: false }
  return {
    settings,
    appState,
    profile: empty ? { ...demoProfile(), aboutMe: '', level: null, summary: '' } : demoProfile(),
    subjects: empty ? [] : demoSubjects(),
    concepts: empty ? [] : demoConcepts(),
    encounters: empty ? [] : demoEncounters(),
    assignments: empty ? [] : demoAssignments(),
    roadmaps: empty ? [] : demoRoadmaps(),
    quizzes: empty ? [] : demoQuizzes(),
    chat: empty ? [] : demoChat(),
    usage: empty ? { rows: [], limits: demoUsage().limits } : demoUsage(),
    sessionRoadmapId: empty ? null : 'rm_orgo',
    sessionPhase: null,
    weekMinutes: empty ? {} : { ...demoWeek.minutes },
    questionsAnswered: empty ? 0 : demoWeek.questionsAnswered,
    correct: empty ? 0 : demoWeek.correct,
    grantAt: { accessibility: null, screenRecording: null },
  }
}
