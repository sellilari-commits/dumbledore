/**
 * Domain model shared by every process (main, engine, renderer).
 *
 * zod schemas are the source of truth; TypeScript types are inferred from them. Dates are
 * ISO-8601 strings so they cross IPC unchanged. Ids are opaque prefixed strings (see engine/ids).
 */
import { z } from 'zod'

export const Id = z.string().min(1)
export type Id = z.infer<typeof Id>
export const IsoDate = z.string()
export type IsoDate = z.infer<typeof IsoDate>

export const NotionColor = z.enum([
  'default',
  'gray',
  'brown',
  'orange',
  'yellow',
  'green',
  'blue',
  'purple',
  'pink',
  'red',
])
export type NotionColor = z.infer<typeof NotionColor>

export const UnderstandingStatus = z.enum(['understood', 'unclear', 'struggling', 'unknown'])
export type UnderstandingStatus = z.infer<typeof UnderstandingStatus>
export const MasteryStatus = z.enum(['new', 'learning', 'struggling', 'mastered'])
export type MasteryStatus = z.infer<typeof MasteryStatus>
export const SubjectStatus = z.enum(['active', 'suggested', 'archived'])
export type SubjectStatus = z.infer<typeof SubjectStatus>
export const FocusMode = z.enum(['normal', 'focus', 'muted'])
export type FocusMode = z.infer<typeof FocusMode>
export const InboxState = z.enum(['new', 'accepted', 'ignored'])
export type InboxState = z.infer<typeof InboxState>

// ─── Subjects & concepts ────────────────────────────────────────────────────────────────────

export const Subject = z.object({
  id: Id,
  name: z.string(),
  emoji: z.string(),
  color: NotionColor,
  description: z.string(),
  goal: z.string().nullable(),
  deadline: IsoDate.nullable(),
  status: SubjectStatus,
  focus: FocusMode,
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type Subject = z.infer<typeof Subject>

/** A subject plus the derived numbers every list view shows. */
export const SubjectSummary = Subject.extend({
  progress: z.number().min(0).max(1), // share of the active roadmap that is done
  mastery: z.number().min(0).max(1), // mean concept mastery
  dueReviews: z.number().int(),
  openQuestions: z.number().int(),
  studyMinutesWeek: z.number(),
  lastStudiedAt: IsoDate.nullable(),
})
export type SubjectSummary = z.infer<typeof SubjectSummary>

export const Concept = z.object({
  id: Id,
  subjectId: Id,
  parentId: Id.nullable(),
  name: z.string(),
  summary: z.string(),
  mastery: z.number().min(0).max(1),
  box: z.number().int().min(0).max(5), // Leitner box; 0 = never reviewed
  nextReviewAt: IsoDate.nullable(),
  status: MasteryStatus,
  struggleCount: z.number().int(),
  lastSeenAt: IsoDate.nullable(),
  /** The student wrote or edited the summary: consolidation never rewrites it. Absent = false. */
  summaryPinned: z.boolean().optional(),
})
export type Concept = z.infer<typeof Concept>

// ─── What Dumbledore saw ────────────────────────────────────────────────────────────────────

export const SourceRef = z.object({
  app: z.string(),
  bundleId: z.string().nullable(),
  url: z.string().nullable(),
  title: z.string().nullable(),
})
export type SourceRef = z.infer<typeof SourceRef>

/** One extracted learning record: the three parts from the brief + evidence and follow-ups. */
export const Encounter = z.object({
  id: Id,
  subjectId: Id.nullable(),
  conceptId: Id.nullable(),
  episodeId: Id.nullable(),
  seen: z.string(), // ① the actual thing on screen
  bigPicture: z.string(), // ② what they were trying to understand, and why
  topicPath: z.array(z.string()), // ② hierarchical: broad → specific
  understanding: UnderstandingStatus, // ③ did they understand it?
  evidence: z.string(),
  openQuestions: z.array(z.string()),
  keyTerms: z.array(z.string()),
  source: SourceRef,
  dwellSeconds: z.number(),
  inboxState: InboxState,
  createdAt: IsoDate,
})
export type Encounter = z.infer<typeof Encounter>

/**
 * One fact, definition, formula, example, highlighted passage or question, short enough to quiz
 * on; or a misconception an exam showed ("thinks the base deprotonates the substrate"), pinned.
 */
export const NoteKind = z.enum([
  'fact',
  'definition',
  'formula',
  'example',
  'highlight',
  'question',
  'misconception',
])
export type NoteKind = z.infer<typeof NoteKind>

export const NoteStatus = z.enum(['active', 'merged', 'deleted'])
export type NoteStatus = z.infer<typeof NoteStatus>

/**
 * An atomic note (docs/NOTES.md §3). `subjectId` null = a loose note (casual reading that matched
 * no subject) until the student files it; `conceptId` null = not placed in the tree yet.
 * `pinned` = edited by the student: consolidation never rewrites or merges it.
 */
export const Note = z.object({
  id: Id,
  subjectId: Id.nullable(),
  conceptId: Id.nullable(),
  encounterId: Id.nullable(),
  kind: NoteKind,
  text: z.string(),
  /** 1–5 keywords from the extractor, for linking notes later (A-MEM style). */
  keywords: z.array(z.string()),
  source: SourceRef,
  status: NoteStatus,
  mergedInto: Id.nullable(),
  pinned: z.boolean(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type Note = z.infer<typeof Note>

/** "`fromId` comes before `toId`": `toId` can't be understood without `fromId` (same subject). */
export const ConceptEdge = z.object({
  fromId: Id,
  toId: Id,
  why: z.string(),
  source: z.enum(['llm', 'user']),
  createdAt: IsoDate,
})
export type ConceptEdge = z.infer<typeof ConceptEdge>

export const Assignment = z.object({
  id: Id,
  subjectId: Id.nullable(),
  title: z.string(),
  course: z.string().nullable(),
  dueAt: IsoDate.nullable(),
  source: z.string(),
  status: z.enum(['open', 'done', 'dismissed']),
  createdAt: IsoDate,
})
export type Assignment = z.infer<typeof Assignment>

export const EpisodeKind = z.enum(['reading', 'ai_chat', 'other'])
export type EpisodeKind = z.infer<typeof EpisodeKind>

export const EpisodeSignals = z.object({
  readingWpm: z.number().nullable(),
  baselineWpm: z.number().nullable(),
  scrollBacks: z.number().int(),
  revisitsToday: z.number().int(),
  searches: z.array(z.string()),
  aiQuestions: z.array(z.string()),
  /** Text the student selected (marked) on this page: a note they chose to keep. */
  highlights: z.array(z.string()).default([]),
})
export type EpisodeSignals = z.infer<typeof EpisodeSignals>

/** A continuous stretch in one app/page. Its text is kept only for the retention window. */
export const Episode = z.object({
  id: Id,
  bundleId: z.string(),
  app: z.string(),
  title: z.string().nullable(),
  url: z.string().nullable(),
  kind: EpisodeKind,
  aiProvider: z.string().nullable(),
  startedAt: IsoDate,
  endedAt: IsoDate,
  dwellSeconds: z.number(),
  text: z.string(),
  source: z.enum(['ax', 'ocr', 'mixed']),
  signals: EpisodeSignals,
  extracted: z.boolean(),
})
export type Episode = z.infer<typeof Episode>

// ─── Roadmaps ───────────────────────────────────────────────────────────────────────────────

export const TeachingMove = z.enum([
  'intuition',
  'definition',
  'worked_example',
  'contrast',
  'apply',
  'explain_back',
  'predict',
  'big_picture',
])
export type TeachingMove = z.infer<typeof TeachingMove>
export const ItemStatus = z.enum(['todo', 'current', 'done', 'skipped'])
export type ItemStatus = z.infer<typeof ItemStatus>

export const Probe = z.object({ concept: z.string(), misconception: z.string() })
export type Probe = z.infer<typeof Probe>

export const LearnItem = z.object({
  kind: z.literal('learn'),
  id: Id,
  idx: z.number().int(),
  title: z.string(),
  objective: z.string(),
  concepts: z.array(z.string()),
  move: TeachingMove,
  promptDraft: z.string(),
  promptSent: z.string().nullable(),
  status: ItemStatus,
})
export type LearnItem = z.infer<typeof LearnItem>

export const CheckpointItem = z.object({
  kind: z.literal('checkpoint'),
  id: Id,
  idx: z.number().int(),
  title: z.string(),
  covers: z.array(z.string()),
  probes: z.array(Probe),
  nQuestions: z.number().int(),
  quizId: Id.nullable(),
  score: z.number().nullable(),
  status: ItemStatus,
})
export type CheckpointItem = z.infer<typeof CheckpointItem>

export const RoadmapItem = z.discriminatedUnion('kind', [LearnItem, CheckpointItem])
export type RoadmapItem = z.infer<typeof RoadmapItem>

export const Roadmap = z.object({
  id: Id,
  subjectId: Id,
  title: z.string(),
  goal: z.string(),
  startReason: z.string(),
  offerPlacement: z.boolean(),
  estimatedMinutes: z.number(),
  status: z.enum(['active', 'paused', 'done']),
  items: z.array(RoadmapItem),
  carry: z.array(z.string()), // concept names missed in a checkpoint and not yet re-passed
  nextMilestone: z.string().nullable(),
  createdAt: IsoDate,
  updatedAt: IsoDate,
})
export type Roadmap = z.infer<typeof Roadmap>

// ─── Quizzes & exams ────────────────────────────────────────────────────────────────────────

export const QuizKind = z.enum(['checkpoint', 'exam', 'review', 'placement'])
export type QuizKind = z.infer<typeof QuizKind>

export const Question = z.object({
  id: Id,
  conceptName: z.string(),
  conceptId: Id.nullable(),
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  rationales: z.array(z.string()).length(4),
  difficulty: z.number().int().min(1).max(3),
  carriedFrom: Id.nullable(),
})
export type Question = z.infer<typeof Question>

export const Answer = z.object({
  questionId: Id,
  chosenIndex: z.number().int().min(0).max(3),
  correct: z.boolean(),
  answeredAt: IsoDate,
})
export type Answer = z.infer<typeof Answer>

export const Quiz = z.object({
  id: Id,
  kind: QuizKind,
  title: z.string(),
  subjectIds: z.array(Id),
  roadmapId: Id.nullable(),
  roadmapItemId: Id.nullable(),
  status: z.enum(['generating', 'ready', 'in_progress', 'done', 'failed']),
  questions: z.array(Question),
  answers: z.array(Answer),
  score: z.number().nullable(),
  createdAt: IsoDate,
  completedAt: IsoDate.nullable(),
})
export type Quiz = z.infer<typeof Quiz>

export const ExamSpec = z.object({
  subjectIds: z.array(Id).min(1),
  count: z.union([z.literal(5), z.literal(10), z.literal(20)]),
  focus: z.enum(['weak', 'due', 'everything']),
  difficulty: z.enum(['mixed', 'easy', 'hard']),
})
export type ExamSpec = z.infer<typeof ExamSpec>

export const AnswerResult = z.object({
  correct: z.boolean(),
  correctIndex: z.number().int(),
  rationale: z.string(),
})
export type AnswerResult = z.infer<typeof AnswerResult>

export const QuizResult = z.object({
  quizId: Id,
  score: z.number(),
  correct: z.number().int(),
  total: z.number().int(),
  byConcept: z.array(
    z.object({
      conceptName: z.string(),
      correct: z.number().int(),
      total: z.number().int(),
      status: MasteryStatus,
    }),
  ),
  gaps: z.array(Probe),
  fixPrompt: z.string().nullable(),
  nextTopic: z.string().nullable(),
})
export type QuizResult = z.infer<typeof QuizResult>

// ─── Coaching ───────────────────────────────────────────────────────────────────────────────

/** What a piece of student feedback is about, so it reaches the prompts it concerns. */
export const FeedbackScope = z.enum(['study_plan', 'quizzes', 'prompts', 'memory', 'general'])
export type FeedbackScope = z.infer<typeof FeedbackScope>

/** Feedback the student gave Dumbledore in the chat ("your quizzes are too easy"). */
export const Feedback = z.object({
  id: Id,
  scope: FeedbackScope,
  subjectId: Id.nullable(),
  text: z.string(),
  createdAt: IsoDate,
})
export type Feedback = z.infer<typeof Feedback>

export const CoachAction = z.discriminatedUnion('type', [
  z.object({ type: z.literal('start_roadmap'), subjectId: Id.nullable(), goal: z.string() }),
  z.object({ type: z.literal('create_exam'), spec: ExamSpec }),
  z.object({ type: z.literal('start_review'), conceptIds: z.array(Id) }),
  z.object({ type: z.literal('insert_prompt'), text: z.string() }),
  z.object({ type: z.literal('set_focus'), subjectId: Id.nullable() }),
  z.object({ type: z.literal('open_subject'), subjectId: Id }),
  /** The student's own words on what a subject's roadmap should cover ("SN1, not SN2"). */
  z.object({ type: z.literal('adjust_roadmap'), subjectId: Id, instruction: z.string() }),
  /** A note the student typed in the chat; saved at once (null ids = the current topic). */
  z.object({
    type: z.literal('add_note'),
    text: z.string(),
    subjectId: Id.nullable(),
    conceptId: Id.nullable(),
  }),
  /** The "Undo" chip after a typed note: deletes that note. */
  z.object({ type: z.literal('undo_note'), noteId: Id }),
  /**
   * Something the student asked or doesn't get, said to Dumbledore: saved at once as an open
   * question on the topic (by id, else by name, else the current topic); `stuck` also marks the
   * topic as a gap. Prompts, outlines and roadmaps aim at it.
   */
  z.object({
    type: z.literal('save_question'),
    text: z.string(),
    subjectId: Id.nullable(),
    conceptId: Id.nullable(),
    topic: z.string().nullable(),
    stuck: z.boolean(),
  }),
  /** A fact about the student's course said in the chat: goal, exam date, what it covers. */
  z.object({
    type: z.literal('update_subject'),
    subjectId: Id,
    goal: z.string().nullable(),
    /** YYYY-MM-DD. */
    deadline: z.string().nullable(),
    /** What the course covers, in the student's words (the subject's description). */
    scope: z.string().nullable(),
  }),
  /** The "Undo" chip after something the chat saved (a question, a course fact). */
  z.object({ type: z.literal('undo_save'), saveId: z.string() }),
  /** Feedback about Dumbledore itself, stored and fed into the prompts of its scope. */
  z.object({
    type: z.literal('give_feedback'),
    text: z.string(),
    scope: FeedbackScope,
    subjectId: Id.nullable(),
  }),
])
export type CoachAction = z.infer<typeof CoachAction>

export const ChatMessage = z.object({
  id: Id,
  thread: z.string(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  actions: z.array(CoachAction),
  createdAt: IsoDate,
})
export type ChatMessage = z.infer<typeof ChatMessage>

export const NudgeKind = z.enum([
  'review_due',
  'struggle',
  'deadline',
  'session_followup',
  'morning_plan',
  'evening_wrap',
  'tip',
])
export type NudgeKind = z.infer<typeof NudgeKind>

export const Nudge = z.object({
  id: Id,
  kind: NudgeKind,
  title: z.string(),
  body: z.string(),
  action: CoachAction.nullable(),
  dedupeKey: z.string(),
  createdAt: IsoDate,
  shownAt: IsoDate.nullable(),
  outcome: z.enum(['pending', 'accepted', 'dismissed', 'snoozed', 'expired']),
})
export type Nudge = z.infer<typeof Nudge>

export const PromptHabits = z.object({
  promptsSeen: z.number().int(),
  withContext: z.number().int(),
  withStructure: z.number().int(),
  askedToBeQuizzed: z.number().int(),
  askedForExamples: z.number().int(),
})
export type PromptHabits = z.infer<typeof PromptHabits>

export const Profile = z.object({
  aboutMe: z.string(),
  level: z.string().nullable(),
  promptLanguage: z.enum(['auto', 'en', 'fi', 'sv']),
  habits: PromptHabits,
  summary: z.string(),
  updatedAt: IsoDate,
})
export type Profile = z.infer<typeof Profile>

// ─── Settings ───────────────────────────────────────────────────────────────────────────────

export const TriggerKey = z.enum([
  'rightOption',
  'leftOption',
  'rightCommand',
  'rightShift',
  'rightControl',
  'fn',
])
export type TriggerKey = z.infer<typeof TriggerKey>

export const Settings = z.object({
  captureEnabled: z.boolean(),
  ocrEnabled: z.boolean(),
  cadence: z.object({ activeMs: z.number().int(), idleMs: z.number().int() }),
  /** User additions; the built-in blocklist lives in engine/privacy. */
  excludedBundleIds: z.array(z.string()),
  excludedHosts: z.array(z.string()),
  orb: z.object({
    visible: z.boolean(),
    followChatBoxes: z.boolean(),
    hideIntoEdge: z.boolean(),
    home: z.object({ displayId: z.number(), x: z.number(), y: z.number() }).nullable(),
  }),
  shortcut: z.object({
    key: TriggerKey,
    fallbackChord: z.string(),
    tapMaxMs: z.number().int(),
    holdMinMs: z.number().int(),
    doubleTapMs: z.number().int(),
  }),
  coaching: z.object({
    nudgesPerDay: z.number().int(),
    minGapMinutes: z.number().int(),
    quietHours: z.object({ start: z.string(), end: z.string() }).nullable(), // "HH:MM"
    morningPlan: z.boolean(),
    eveningWrap: z.boolean(),
  }),
  privacy: z.object({ episodeRetentionHours: z.number().int(), redact: z.boolean() }),
  ai: z.object({
    geminiKeySet: z.boolean(),
    groqKeySet: z.boolean(),
    mistralKeySet: z.boolean(),
    useOnDevice: z.boolean(),
    modelOverrides: z.record(z.string(), z.string()), // "tier" → "provider:model"
  }),
  autoSend: z.boolean(), // unused: Dumbledore never sends for the student; kept for old data
  theme: z.enum(['system', 'light', 'dark']),
  focusSubjectId: Id.nullable(),
  /** Topic locked in the mini panel (a top-level concept); null = follow the latest. */
  focusTopicId: Id.nullable(),
  /** Length of the timer under the orb, the last one picked (1–180 minutes). */
  timerMinutes: z.number().int().min(1).max(180),
  onboardingDone: z.boolean(),
})
export type Settings = z.infer<typeof Settings>

export const SettingsPatch = Settings.partial()
export type SettingsPatch = z.infer<typeof SettingsPatch>

export const DEFAULT_SETTINGS: Settings = {
  captureEnabled: true,
  ocrEnabled: true,
  cadence: { activeMs: 1000, idleMs: 10000 },
  excludedBundleIds: [],
  excludedHosts: [],
  orb: { visible: true, followChatBoxes: false, hideIntoEdge: false, home: null },
  shortcut: {
    key: 'rightOption',
    fallbackChord: 'Control+Option+D',
    tapMaxMs: 350,
    holdMinMs: 500,
    doubleTapMs: 300,
  },
  coaching: {
    nudgesPerDay: 4,
    minGapMinutes: 60,
    quietHours: { start: '22:30', end: '08:00' },
    morningPlan: true,
    eveningWrap: true,
  },
  privacy: { episodeRetentionHours: 48, redact: true },
  ai: {
    geminiKeySet: false,
    groqKeySet: false,
    mistralKeySet: false,
    useOnDevice: true,
    modelOverrides: {},
  },
  autoSend: false,
  theme: 'system',
  focusSubjectId: null,
  focusTopicId: null,
  timerMinutes: 25,
  onboardingDone: false,
}
