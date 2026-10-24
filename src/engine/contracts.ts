/**
 * Engine-internal contracts: storage, the helper client, and the services the shell calls.
 *
 * Lanes build against these interfaces in parallel (docs/PLAN.md §8.0) and swap fakes for real
 * implementations during integration. Change an interface only together with every implementer.
 */
import type {
  Answer,
  AnswerResult,
  Assignment,
  ChatMessage,
  Concept,
  ConceptEdge,
  Encounter,
  Episode,
  ExamSpec,
  Id,
  InboxState,
  IsoDate,
  Note,
  NoteKind,
  NoteStatus,
  NotionColor,
  Nudge,
  Profile,
  Quiz,
  QuizKind,
  QuizResult,
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
  SubjectTree,
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
  /**
   * Deletes a subject and everything remembered about it: its concepts, encounters (and their
   * screen text), notes, prerequisite edges, roadmaps, assignments, chat, nudges and the exams
   * that cover only it.
   */
  remove(id: Id): void
  /** When notes consolidation last ran for the subject (docs/NOTES.md §5); null = never. */
  consolidatedAt(id: Id): IsoDate | null
  markConsolidated(id: Id, at: IsoDate): void
}

export interface ConceptRepo {
  listBySubject(subjectId: Id): Concept[]
  get(id: Id): Concept | null
  /** Case- and whitespace-insensitive within the subject. */
  findByName(subjectId: Id, name: string): Concept | null
  /** Creates the concept (and its parent by name, if given and missing) or returns the existing one. */
  upsert(input: {
    subjectId: Id
    name: string
    parentName?: string | null
    summary?: string
  }): Concept
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
  /**
   * Deletes a concept (docs/NOTES.md §7): its notes are deleted, its children move up to its
   * parent, its encounters and quiz questions lose the link, its edges go.
   */
  remove(id: Id): void
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
  /**
   * Deletes an encounter and its notes, and the screen text behind it (its episode) unless
   * another encounter still uses it.
   */
  remove(id: Id): void
}

export interface NewNoteInput {
  subjectId: Id | null
  conceptId: Id | null
  encounterId: Id | null
  kind: NoteKind
  text: string
  keywords?: string[]
  source: Note['source']
}

/** Atomic notes (docs/NOTES.md §3). Lists return active notes unless a status is given. */
export interface NoteRepo {
  /**
   * Adds a note, trimmed and cut at 200 characters. If an active note in the same place (same
   * concept; else same subject without concept; else the loose notes) says the same thing
   * (note-key.ts), nothing is added: that note gains the new keywords, its updatedAt is touched
   * and it comes back with `created: false`. Keywords are trimmed, deduped and capped at 5.
   */
  add(input: NewNoteInput): { note: Note; created: boolean }
  get(id: Id): Note | null
  /** Oldest first. `subjectId: null` = loose notes; `status: null` = every status. */
  list(filter: {
    subjectId?: Id | null
    conceptId?: Id
    encounterId?: Id
    status?: NoteStatus | null
    limit?: number
  }): Note[]
  update(
    id: Id,
    patch: Partial<
      Pick<
        Note,
        | 'text'
        | 'kind'
        | 'keywords'
        | 'subjectId'
        | 'conceptId'
        | 'status'
        | 'mergedInto'
        | 'pinned'
      >
    >,
  ): Note
  /** Soft delete: status 'deleted' (it leaves lists, search and the memory file). */
  remove(id: Id): void
  /** `fromId` becomes status 'merged' pointing at `intoId`; `text` rewrites the survivor. */
  merge(fromId: Id, intoId: Id, text?: string): Note
}

/** Prerequisite edges between concepts of one subject (docs/NOTES.md §6). */
export interface EdgeRepo {
  /** Edges whose concepts belong to the subject, oldest first. */
  list(subjectId: Id): ConceptEdge[]
  /**
   * Adds `fromId → toId`. Returns null (and adds nothing) for a self-loop, concepts of different
   * subjects, an edge that exists already or one that would close a cycle.
   */
  add(input: {
    fromId: Id
    toId: Id
    why?: string
    source?: ConceptEdge['source']
  }): ConceptEdge | null
  remove(fromId: Id, toId: Id): void
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
  update(
    id: Id,
    patch: Partial<Pick<Assignment, 'status' | 'subjectId' | 'dueAt' | 'title'>>,
  ): Assignment
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
  countSince(
    provider: ProviderId,
    model: string,
    sinceIso: IsoDate,
  ): { requests: number; tokens: number }
}

export interface SearchRepo {
  query(q: string, limit: number): SearchHit[]
}

export interface Repos {
  subjects: SubjectRepo
  concepts: ConceptRepo
  encounters: EncounterRepo
  notes: NoteRepo
  edges: EdgeRepo
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
  /**
   * The shell could not paste the prompt of step `itemId` (the AI chat wasn't frontmost, the
   * write failed or was cancelled). The step stops counting as delivered, so the next `next()`
   * hands out the same prompt again instead of advancing. Unknown or finished items are ignored.
   */
  pasteFailed(itemId: Id): void
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

/** What the student sees and edits of the memory (docs/NOTES.md §7; subjects/memory-control.ts). */
export interface MemoryControl {
  tree(subjectId: Id): SubjectTree
  /** Notes of casual reading that matched no subject, newest first. */
  looseNotes(): Note[]
  /** The student's edit: the note becomes pinned (consolidation never rewrites it). */
  updateNote(id: Id, text: string): Note
  /** Returns the deleted note (for its subject). */
  deleteNote(id: Id): Note
  fileNote(id: Id, subjectId: Id, conceptId: Id | null): Note
  updateConcept(id: Id, patch: { name?: string; summary?: string }): Concept
  /** Returns the deleted concept. */
  deleteConcept(id: Id): Concept
  /** Returns the deleted encounter. */
  deleteEncounter(id: Id): Encounter
}

export interface SubjectService extends MemoryControl {
  create(input: NewSubjectInput): Subject
  update(id: Id, patch: SubjectPatch): Subject
  /** Deletes the subject and everything Dumbledore remembers about it. */
  remove(id: Id): void
  actSuggested(subjectId: Id, action: 'accept' | 'dismiss' | 'merge', intoId: Id | null): void
  actInbox(encounterId: Id, action: 'accept' | 'ignore' | 'assign', subjectId: Id | null): void
  addAssignment(input: NewAssignmentInput): Assignment
}

/** Regenerates the human-readable per-subject Markdown "memory file". */
export interface MemoryMirror {
  regenerate(subjectId: Id): void
  regenerateAll(): void
}
