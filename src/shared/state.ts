/**
 * View models: the shapes the main process hands to the windows.
 *
 * Domain records live in ./domain; this file holds what screens need on top of them (summaries,
 * the overlay's visual state, the study session as the UI sees it).
 */
import { z } from 'zod'
import {
  Assignment,
  CoachAction,
  Concept,
  ConceptEdge,
  Encounter,
  EpisodeKind,
  Id,
  IsoDate,
  Note,
  PromptHabits,
  QuizKind,
  Roadmap,
  RoadmapItem,
  Subject,
  SubjectSummary,
} from './domain'
import { Rect } from './geometry'

// ─── App-wide status ────────────────────────────────────────────────────────────────────────

export const PermissionsStatus = z.object({
  accessibility: z.boolean(),
  screenRecording: z.boolean(),
})
export type PermissionsStatus = z.infer<typeof PermissionsStatus>

/** What Dumbledore thinks you are doing right now (drives "Right now" in the panel). */
export const NowContext = z.object({
  app: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  minutes: z.number(),
  kind: EpisodeKind,
  subjectId: Id.nullable(),
  suggestion: z.object({ label: z.string(), action: CoachAction }).nullable(),
})
export type NowContext = z.infer<typeof NowContext>

export const AppState = z.object({
  capture: z.object({ enabled: z.boolean(), active: z.boolean() }),
  permissions: PermissionsStatus,
  helper: z.enum(['connected', 'starting', 'down']),
  ai: z.object({
    ready: z.boolean(),
    onDevice: z.boolean(),
    providers: z.array(z.object({ id: z.string(), ok: z.boolean() })),
  }),
  focusSubjectId: Id.nullable(),
  now: NowContext.nullable(),
  aiChat: z.object({ provider: z.string() }).nullable(),
  /**
   * The student's AI for labels and links: the open AI chat, else the one they usually study with
   * (learned from their captures); null when Dumbledore hasn't seen one yet.
   */
  assistant: z
    .object({ key: z.string(), name: z.string(), open: z.boolean() })
    .nullable()
    .optional(),
  onboardingDone: z.boolean(),
  version: z.string(),
})
export type AppState = z.infer<typeof AppState>

// ─── Overlay (orb, side stack, pill, chip, toasts, quiz card) ────────────────────────────────

export const OrbVisual = z.enum(['idle', 'paused', 'thinking', 'session', 'attention', 'docked'])
export type OrbVisual = z.infer<typeof OrbVisual>

export const Toast = z.object({
  id: z.string(),
  kind: z.enum(['nudge', 'tip', 'info', 'error']),
  title: z.string(),
  body: z.string(),
  actions: z.array(z.object({ id: z.string(), label: z.string(), primary: z.boolean() })),
  ttlMs: z.number().int(),
  nudgeId: Id.nullable(),
})
export type Toast = z.infer<typeof Toast>

/** One outlined passage: its box in global screen points, what to do with it and why. */
export const OutlineMark = z.object({
  rect: Rect,
  /** Each text line's own box, so the highlight sits on the words like a highlighter pen. */
  lines: z.array(Rect).optional(),
  /** Reading order of a passage to read (1, 2, 3 …); null for skim / skip. */
  order: z.number().int().nullable().optional(),
  verdict: z.enum(['read', 'skim', 'skip']),
  why: z.string(),
})
export type OutlineMark = z.infer<typeof OutlineMark>

/** "Outline what I need to read": marks drawn over the page the student is reading. */
export const OutlineOverlay = z.object({
  /** The window the marks belong to; marks clear when it changes or scrolls. */
  windowId: z.number().int().nullable(),
  /** The window's frame in global points: marks are clipped to it. */
  frame: Rect.nullable().optional(),
  title: z.string().nullable(),
  subjectName: z.string(),
  summary: z.string(),
  /** About how long the passages to read take (200 words a minute). */
  minutes: z.number().int().optional(),
  /** Passages to read elsewhere on the page (they light up when scrolled to). */
  above: z.number().int().optional(),
  below: z.number().int().optional(),
  marks: z.array(OutlineMark),
})
export type OutlineOverlay = z.infer<typeof OutlineOverlay>

export const OverlayState = z.object({
  /** Display the orb is on. Overlays on other displays render nothing. */
  displayId: z.number().int(),
  orb: z.object({
    /** Centre of the orb in display-local points (= overlay window coordinates). */
    x: z.number(),
    y: z.number(),
    size: z.number(), // 40 normally, 28 when docked beside a chat box
    visual: OrbVisual,
    thinking: z.boolean(),
    progress: z.object({ k: z.number().int(), n: z.number().int() }).nullable(),
    dot: z.enum(['none', 'blue', 'orange']),
    paused: z.boolean(),
    docked: z.boolean(),
  }),
  /** The focused chat input the orb is docked to, in display-local points. */
  dockTarget: Rect.nullable(),
  /** Which screen edge the orb is latched to, so stacks and toasts open toward the screen. */
  edge: z.enum(['left', 'right', 'top', 'bottom', 'free']),
  pill: z.object({ label: z.string(), count: z.number().int() }).nullable(),
  side: z.object({ next: z.object({ label: z.string() }).nullable(), quiz: z.boolean() }),
  chip: z.object({ kind: z.enum(['suggest', 'improve']), text: z.string() }).nullable(),
  toasts: z.array(Toast),
  quiz: z.object({ quizId: Id }).nullable(),
  aiChat: z.object({ provider: z.string() }).nullable(),
  /**
   * The timer square under the orb: when it started and when it runs out (null = idle). The
   * square's progress edge is the elapsed share of startedAt → endsAt, so +/− minutes rescale it.
   */
  timer: z.object({ startedAt: IsoDate, endsAt: IsoDate }).nullable(),
  /** Outline marks over the page being read, on every display they touch (null = none). */
  outline: OutlineOverlay.nullable().optional(),
  /** The timer length picked last (minutes); the chooser preselects it. */
  timerMinutes: z.number().int(),
})
export type OverlayState = z.infer<typeof OverlayState>

export const OverlayAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('orbClick') }),
  z.object({ type: z.literal('orbLongPress') }),
  z.object({ type: z.literal('orbContextMenu') }),
  z.object({ type: z.literal('orbDrag'), x: z.number(), y: z.number(), done: z.boolean() }),
  z.object({ type: z.literal('pillClick') }),
  z.object({ type: z.literal('chipClick') }),
  z.object({ type: z.literal('sideNext') }),
  z.object({ type: z.literal('sideQuiz') }),
  /** The running timer: stop it. */
  z.object({ type: z.literal('timerClick') }),
  /** The running timer: add (or take off) minutes; at least one minute stays. */
  z.object({ type: z.literal('timerAdjust'), deltaMinutes: z.number().int().min(-180).max(180) }),
  /** The timer chooser: start a timer of this many minutes (remembered as the next default). */
  z.object({ type: z.literal('timerStart'), minutes: z.number().int().min(1).max(180) }),
  z.object({ type: z.literal('toastAction'), toastId: z.string(), actionId: z.string() }),
  z.object({ type: z.literal('toastDismiss'), toastId: z.string() }),
  z.object({ type: z.literal('quizClose') }),
  /** The page reports whether the pointer is over a hit area, for click-through toggling. */
  z.object({ type: z.literal('hover'), inside: z.boolean() }),
])
export type OverlayAction = z.infer<typeof OverlayAction>

// ─── Study session ──────────────────────────────────────────────────────────────────────────

export const SessionState = z.object({
  roadmapId: Id,
  subjectId: Id,
  subjectName: z.string(),
  subjectEmoji: z.string(),
  title: z.string(),
  phase: z.enum(['planning', 'step', 'checkpoint', 'complete', 'paused', 'error']),
  index: z.number().int(), // index of the current item
  total: z.number().int(),
  items: z.array(RoadmapItem),
  nextAction: z.enum(['paste_next', 'open_quiz', 'finish', 'none']),
  assistant: z.string().nullable(), // "ChatGPT", "Claude", …
  startReason: z.string(),
  offerPlacement: z.boolean(),
  error: z.string().nullable(),
})
export type SessionState = z.infer<typeof SessionState>

export const StartSessionInput = z.object({
  subjectId: Id.nullable(),
  goal: z.string().nullable(),
  question: z.string().nullable(),
  /**
   * Plan a fresh roadmap even when an open one has this goal (adjust_roadmap). The words say why;
   * the replaced roadmap keeps them in the subject's roadmap history.
   */
  replan: z.string().optional(),
})
export type StartSessionInput = z.infer<typeof StartSessionInput>

/** What the shell should do next for the active session. The shell performs the paste. */
export const StepInstruction = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('paste'),
    text: z.string(),
    coachTip: z.string().nullable(),
    itemId: Id,
  }),
  z.object({ kind: z.literal('quiz'), quizId: Id, itemId: Id }),
  z.object({ kind: z.literal('complete'), summary: z.string() }),
  z.object({ kind: z.literal('wait'), reason: z.string() }),
])
export type StepInstruction = z.infer<typeof StepInstruction>

export const PickerData = z.object({
  subjects: z.array(
    z.object({
      subject: SubjectSummary,
      questions: z.array(z.string()),
      hasActiveRoadmap: z.boolean(),
    }),
  ),
})
export type PickerData = z.infer<typeof PickerData>

// ─── Pages ──────────────────────────────────────────────────────────────────────────────────

export const QuizSummary = z.object({
  id: Id,
  kind: QuizKind,
  title: z.string(),
  subjectIds: z.array(Id),
  score: z.number().nullable(),
  questionCount: z.number().int(),
  createdAt: IsoDate,
  completedAt: IsoDate.nullable(),
})
export type QuizSummary = z.infer<typeof QuizSummary>

export const HomeData = z.object({
  greetingName: z.string(),
  continue: z.array(
    z.object({
      roadmapId: Id,
      subjectId: Id,
      subjectName: z.string(),
      subjectEmoji: z.string(),
      title: z.string(),
      index: z.number().int(),
      total: z.number().int(),
    }),
  ),
  dueReviews: z.array(
    z.object({ conceptId: Id, conceptName: z.string(), subjectId: Id, subjectEmoji: z.string() }),
  ),
  struggling: z.array(
    z.object({
      conceptId: Id,
      conceptName: z.string(),
      subjectId: Id,
      subjectEmoji: z.string(),
      reason: z.string(),
    }),
  ),
  deadlines: z.array(
    z.object({
      id: Id,
      title: z.string(),
      dueAt: IsoDate,
      kind: z.enum(['assignment', 'subject']),
      subjectId: Id.nullable(),
      subjectEmoji: z.string().nullable(),
    }),
  ),
  week: z.object({
    minutesBySubject: z.array(
      z.object({ subjectId: Id, name: z.string(), emoji: z.string(), minutes: z.number() }),
    ),
    questionsAnswered: z.number().int(),
    accuracy: z.number().nullable(),
  }),
  habits: PromptHabits,
})
export type HomeData = z.infer<typeof HomeData>

/** What Your gaps shows under a topic: a misconception from an exam, or a question asked. */
export const GapNote = z.object({
  id: Id,
  conceptId: Id.nullable(),
  kind: z.enum(['misconception', 'question']),
  text: z.string(),
  createdAt: IsoDate,
  /** "Exam: Organic Chemistry · weak spots", "Asked Dumbledore". */
  source: z.string(),
})
export type GapNote = z.infer<typeof GapNote>

export const SubjectDetail = z.object({
  subject: SubjectSummary,
  roadmap: Roadmap.nullable(),
  concepts: z.array(Concept),
  encounters: z.array(Encounter),
  exams: z.array(QuizSummary),
  assignments: z.array(Assignment),
  /** Misconceptions and questions per topic, newest first (Your gaps). */
  gapNotes: z.array(GapNote).optional(),
})
export type SubjectDetail = z.infer<typeof SubjectDetail>

/** One page (or app window) a topic was read in, from its notes (newest first). */
export const TopicSource = z.object({
  title: z.string(),
  url: z.string().nullable(),
  app: z.string(),
  lastSeenAt: IsoDate,
  noteCount: z.number().int(),
  /** That page's notes (ids of the topic's and its subtree's notes), oldest first. */
  noteIds: z.array(z.string()),
})
export type TopicSource = z.infer<typeof TopicSource>

/**
 * One concept of a subject's topic tree with its active notes (oldest first) and its sources: the
 * pages its notes and its subtree's were read in (a topic unites many pages).
 */
export const ConceptNode = z.object({
  concept: Concept,
  notes: z.array(Note),
  sources: z.array(TopicSource).optional(),
})
export type ConceptNode = z.infer<typeof ConceptNode>

/**
 * A subject's memory as a tree (docs/NOTES.md §7): concepts in tree order (each parent before its
 * children, siblings by name) with their notes, the subject's notes not placed on a concept yet,
 * and the prerequisite edges (read-only in the UI).
 */
export const SubjectTree = z.object({
  subjectId: Id,
  concepts: z.array(ConceptNode),
  unplaced: z.array(Note),
  edges: z.array(ConceptEdge),
})
export type SubjectTree = z.infer<typeof SubjectTree>

export const NewSubjectInput = z.object({
  name: z.string().min(1),
  emoji: z.string().nullable(),
  goal: z.string().nullable(),
  deadline: IsoDate.nullable(),
})
export type NewSubjectInput = z.infer<typeof NewSubjectInput>

export const SubjectPatch = Subject.pick({
  name: true,
  emoji: true,
  color: true,
  description: true,
  goal: true,
  deadline: true,
  status: true,
  focus: true,
}).partial()
export type SubjectPatch = z.infer<typeof SubjectPatch>

export const NewAssignmentInput = z.object({
  title: z.string().min(1),
  subjectId: Id.nullable(),
  dueAt: IsoDate.nullable(),
})
export type NewAssignmentInput = z.infer<typeof NewAssignmentInput>

export const SearchHit = z.object({
  kind: z.enum(['subject', 'concept', 'encounter', 'exam']),
  id: Id,
  title: z.string(),
  snippet: z.string(),
  subjectId: Id.nullable(),
  route: z.string(), // app route to open, e.g. "/subjects/sub_123/concepts"
})
export type SearchHit = z.infer<typeof SearchHit>

export const UsageSummary = z.object({
  rows: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      calls: z.number().int(),
      failures: z.number().int(),
      tokensIn: z.number().int(),
      tokensOut: z.number().int(),
    }),
  ),
  limits: z.array(
    z.object({
      provider: z.string(),
      model: z.string(),
      requestsPerDay: z.number().nullable(),
      tokensPerDay: z.number().nullable(),
    }),
  ),
})
export type UsageSummary = z.infer<typeof UsageSummary>

export const AskResult = z.object({
  reply: z.string(),
  actions: z.array(CoachAction),
  pasted: z.boolean(),
})
export type AskResult = z.infer<typeof AskResult>

export const MemoryScope = z.enum([
  'subjects',
  'concepts',
  'inbox',
  'roadmaps',
  'quizzes',
  'assignments',
  'profile',
  'chat',
  'nudges',
  'settings',
])
export type MemoryScope = z.infer<typeof MemoryScope>

export const MemoryChanged = z.object({ scope: MemoryScope, ids: z.array(z.string()) })
export type MemoryChanged = z.infer<typeof MemoryChanged>

/** Routes of the full app window. */
export const APP_ROUTES = {
  home: '/home',
  inbox: '/inbox',
  exams: '/exams',
  exam: (id: string) => `/exams/${id}`,
  subject: (id: string, view: 'roadmap' | 'concepts' | 'seen' | 'exams' = 'roadmap') =>
    `/subjects/${id}/${view}`,
  settings: (section = 'general') => `/settings/${section}`,
  onboarding: '/onboarding',
} as const
