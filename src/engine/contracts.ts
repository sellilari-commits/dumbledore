/**
 * Engine-internal contracts: storage, the helper client, and the services the shell calls.
 *
 * Lanes build against these interfaces in parallel (docs/PLAN.md §8.0) and swap fakes for real
 * implementations during integration. Change an interface only together with every implementer.
 */
import type {
  Answer,
  Assignment,
  ChatMessage,
  Concept,
  Encounter,
  Episode,
  ExamSpec,
  Id,
  InboxState,
  IsoDate,
  Nudge,
  NotionColor,
  Profile,
  Quiz,
  QuizKind,
  QuizResult,
  AnswerResult,
  Roadmap,
  Settings,
  SettingsPatch,
  Subject,
  SubjectStatus,
  UnderstandingStatus,
} from '@shared/domain'
import type {
  HelperEvent,
  HelperEventPayload,
  HelperMethod,
  HelperParams,
  HelperResult,
} from '@shared/helper-protocol'
import type { LlmTier, ProviderId } from '@shared/llm'
import type {
  HomeData,
  NewAssignmentInput,
  NewSubjectInput,
  NowContext,
  PickerData,
  QuizSummary,
  SearchHit,
  SessionState,
  StartSessionInput,
  StepInstruction,
  SubjectDetail,
  SubjectPatch,
  UsageSummary,
} from '@shared/state'

// ─── Helper client (lane L1) ────────────────────────────────────────────────────────────────

export type HelperStatus = 'connected' | 'starting' | 'down'

export interface HelperClient {
  readonly status: HelperStatus
  start(): Promise<void>
  stop(): Promise<void>
  call<M extends HelperMethod>(
    method: M,
    params: HelperParams<M>,
    opts?: { timeoutMs?: number },
  ): Promise<HelperResult<M>>
  on<E extends HelperEvent>(
    event: E,
    listener: (payload: HelperEventPayload<E>) => void,
  ): () => void
  onStatus(listener: (status: HelperStatus) => void): () => void
}

// ─── Storage (lane L2; in-memory twin in engine/testing/memory-repos.ts) ────────────────────

export interface SubjectRepo {
  list(filter?: { status?: SubjectStatus[] }): Subject[]
  get(id: Id): Subject | null
  /** Case- and whitespace-insensitive. */
  findByName(name: string): Subject | null
  create(input: {
    name: string
    emoji?: string
    color?: NotionColor
    description?: string
    goal?: string | null
    deadline?: IsoDate | null
    status?: SubjectStatus
  }): Subject
  update(id: Id, patch: Partial<Omit<Subject, 'id' | 'createdAt' | 'updatedAt'>>): Subject
  /** Moves concepts, encounters, roadmaps, quizzes and assignments, then deletes `fromId`. */
  merge(fromId: Id, intoId: Id): void
}

export interface ConceptRepo {
  listBySubject(subjectId: Id): Concept[]
  get(id: Id): Concept | null
  /** Case- and whitespace-insensitive within the subject. */
  findByName(subjectId: Id, name: string): Concept | null
  /** Creates the concept (and its parent by name, if given and missing) or returns the existing one. */
  upsert(input: { subjectId: Id; name: string; parentName?: string | null; summary?: string }): Concept
  update(
    id: Id,
    patch: Partial<
      Pick<
        Concept,
        | 'name'
        | 'summary'
        | 'parentId'
        | 'mastery'
        | 'box'
        | 'nextReviewAt'
        | 'status'
        | 'struggleCount'
        | 'lastSeenAt'
      >
    >,
  ): Concept
  /** Concepts with nextReviewAt ≤ now, most overdue first. */
  listDue(nowIso: IsoDate, limit: number): Concept[]
  listStruggling(limit: number): Concept[]
}

export interface EncounterRepo {
  add(
    input: Omit<Encounter, 'id' | 'createdAt' | 'inboxState'> & { inboxState?: InboxState },
  ): Encounter
  list(filter: {
    subjectId?: Id | null
    inboxState?: InboxState | null
    sinceIso?: IsoDate
    limit?: number
  }): Encounter[]
  setInboxState(id: Id, state: InboxState, subjectId?: Id | null): Encounter
  /** Distinct open questions of recent encounters, newest first. */
  openQuestions(subjectId: Id, limit: number): string[]
}

export interface EpisodeRepo {
  /** Insert or replace. */
  save(episode: Episode): void
  get(id: Id): Episode | null
  listUnextracted(limit: number): Episode[]
  markExtracted(id: Id): void
  recent(filter: { sinceIso: IsoDate; limit?: number }): Episode[]
  /** Blanks the text of episodes that ended before `iso`; metadata stays for study-time stats. */
  purgeTextOlderThan(iso: IsoDate): number
}

export interface RoadmapRepo {
  get(id: Id): Roadmap | null
  getActive(subjectId: Id): Roadmap | null
  listBySubject(subjectId: Id): Roadmap[]
  listActive(): Roadmap[]
  /** Insert or replace, items included. */
  save(roadmap: Roadmap): void
}

export interface QuizRepo {
  get(id: Id): Quiz | null
  /** Insert or replace. */
  save(quiz: Quiz): void
  list(filter: { kind?: QuizKind; subjectId?: Id; limit?: number }): Quiz[]
  recordAnswer(quizId: Id, answer: Answer): Quiz
}

export interface AssignmentRepo {
  /** De-duplicates on normalized title + due date. */
  upsert(input: {
    subjectId: Id | null
    title: string
    course?: string | null
    dueAt: IsoDate | null
    source: string
  }): Assignment
  list(filter: { status?: Assignment['status']; subjectId?: Id; limit?: number }): Assignment[]
  update(id: Id, patch: Partial<Pick<Assignment, 'status' | 'subjectId' | 'dueAt' | 'title'>>): Assignment
}

export interface NudgeRepo {
  add(input: Omit<Nudge, 'id' | 'createdAt' | 'shownAt' | 'outcome'>): Nudge
  update(id: Id, patch: Partial<Pick<Nudge, 'shownAt' | 'outcome'>>): Nudge
  listSince(iso: IsoDate): Nudge[]
  findByDedupeKey(key: string, sinceIso: IsoDate): Nudge | null
}

export interface ChatRepo {
  append(input: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage
  history(thread: string, limit: number): ChatMessage[]
}

export interface ProfileRepo {
  get(): Profile
  update(patch: Partial<Omit<Profile, 'updatedAt'>>): Profile
}

export interface SettingsRepo {
  get(): Settings
  update(patch: SettingsPatch): Settings
}

export interface LlmCallRecord {
  at: IsoDate
  provider: ProviderId
  model: string
  tier: LlmTier
  task: string
  tokensIn: number
  tokensOut: number
  latencyMs: number
  ok: boolean
  error: string | null
}

export interface UsageRepo {
  record(call: LlmCallRecord): void
  rowsSince(sinceIso: IsoDate): UsageSummary['rows']
  countSince(provider: ProviderId, model: string, sinceIso: IsoDate): { requests: number; tokens: number }
}

export interface SearchRepo {
  query(q: string, limit: number): SearchHit[]
}

export interface Repos {
  subjects: SubjectRepo
  concepts: ConceptRepo
  encounters: EncounterRepo
  episodes: EpisodeRepo
  roadmaps: RoadmapRepo
  quizzes: QuizRepo
  assignments: AssignmentRepo
  nudges: NudgeRepo
  chat: ChatRepo
  profile: ProfileRepo
  settings: SettingsRepo
  usage: UsageRepo
  search: SearchRepo
  transaction<T>(fn: () => T): T
}

// ─── Perception (lane L3) ───────────────────────────────────────────────────────────────────

export interface AiChatInfo {
  key: string // "chatgpt", "claude", … (see ASSISTANT_NAMES)
  assistant: string // "ChatGPT"
  pid: number
  bundleId: string
  url: string | null
  windowTitle: string | null
}

export interface PerceptionService {
  start(): void
  stop(): void
  setEnabled(enabled: boolean): void
  isActive(): boolean
  now(): NowContext | null
  aiChat(): AiChatInfo | null
  /** Latest visible text of the AI chat window, newest last, roles tagged when inferable. */
  chatExcerpt(maxChars: number): string
  /** Latest text of the frontmost non-chat page (for prompt context). */
  pageContext(maxChars: number): string
}

// ─── Learning services (lanes L4, L5) — called by the shell ─────────────────────────────────

/** Context the shell gathers before asking for a prompt. */
export interface ChatContext {
  assistant: string | null // "ChatGPT"; null when no AI chat is open
  chatExcerpt: string
  pageContext: string
}

export interface StudyService {
  current(): SessionState | null
  picker(): PickerData
  /** Builds or resumes the roadmap and returns the first instruction (usually a paste). */
  start(input: StartSessionInput, ctx: ChatContext): Promise<StepInstruction>
  /** Reads what happened in the chat, updates memory, and returns the next instruction. */
  next(ctx: ChatContext): Promise<StepInstruction>
  pause(): void
  end(): void
  onChange(listener: (session: SessionState | null) => void): () => void
}

export interface PromptService {
  /** Best prompt for an empty chat box (session step › open question › review › starter). */
  suggest(ctx: ChatContext): Promise<{ prompt: string; coachTip: string | null }>
  /** Improve the student's own draft (same intent, + context, structure, brevity). */
  improve(draft: string, ctx: ChatContext): Promise<{ prompt: string; coachTip: string | null }>
}

export interface QuizService {
  get(id: Id): Quiz
  answer(quizId: Id, questionId: Id, chosenIndex: number): AnswerResult
  finish(quizId: Id): Promise<QuizResult>
  /** Returns at once with status 'generating'; completes in the background (memory.changed). */
  createExam(spec: ExamSpec): Promise<Quiz>
  startReview(conceptIds: Id[]): Promise<Quiz>
}

export interface MasteryModel {
  applyAnswer(conceptId: Id, correct: boolean, difficulty: number, atIso: IsoDate): Concept
  applyEncounter(conceptId: Id, understanding: UnderstandingStatus, atIso: IsoDate): Concept
}

export interface FollowUpService {
  start(): void
  stop(): void
  onSessionComplete(roadmapId: Id): void
  dueSummary(): { count: number; conceptIds: Id[] }
}

// ─── Read models & commands (lane L2) ───────────────────────────────────────────────────────

export interface QueryService {
  home(): HomeData
  subjects(): import('@shared/domain').SubjectSummary[]
  subject(id: Id): SubjectDetail
  inbox(filter: { state: InboxState | null; subjectId: Id | null }): Encounter[]
  exams(): QuizSummary[]
  search(q: string): SearchHit[]
  usage(): UsageSummary
  picker(): PickerData
}

export interface SubjectService {
  create(input: NewSubjectInput): Subject
  update(id: Id, patch: SubjectPatch): Subject
  actSuggested(subjectId: Id, action: 'accept' | 'dismiss' | 'merge', intoId: Id | null): void
  actInbox(encounterId: Id, action: 'accept' | 'ignore' | 'assign', subjectId: Id | null): void
  addAssignment(input: NewAssignmentInput): Assignment
}

/** Regenerates the human-readable per-subject Markdown "memory file". */
export interface MemoryMirror {
  regenerate(subjectId: Id): void
  regenerateAll(): void
}
