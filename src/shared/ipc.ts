/**
 * IPC contract between the main process and the windows (overlay, panel, ask bar, app).
 *
 * Every channel is declared once here with zod schemas. The preload exposes a typed
 * `window.dumbledore` built from this contract; main validates every request payload before
 * handling it. Add a channel here first, then implement it in main and use it in the renderer.
 */
import { z } from 'zod'
import {
  AnswerResult,
  Assignment,
  ChatMessage,
  CoachAction,
  Concept,
  Encounter,
  ExamSpec,
  Id,
  InboxState,
  Note,
  Profile,
  Quiz,
  QuizResult,
  Roadmap,
  RoadmapVersion,
  Settings,
  SettingsPatch,
  Subject,
  SubjectSummary,
} from './domain'
import {
  AppState,
  AskResult,
  HomeData,
  MemoryChanged,
  NewAssignmentInput,
  NewSubjectInput,
  OverlayAction,
  OverlayState,
  PermissionsStatus,
  PickerData,
  QuizSummary,
  SearchHit,
  SessionState,
  StartSessionInput,
  SubjectDetail,
  SubjectPatch,
  SubjectTree,
  UsageSummary,
} from './state'

const Void = z.void()
const WindowSurface = z.enum(['app', 'panel', 'askbar'])

/** What adding one study-material file did: how many notes it filed, or why it couldn't. */
export const MaterialResult = z.object({
  name: z.string(),
  ok: z.boolean(),
  notes: z.number().int(),
  truncated: z.boolean(),
  error: z.string().nullable(),
})
export type MaterialResult = z.infer<typeof MaterialResult>

/** "Bring back": the version that is current again, and the ones it moved into the history. */
export const RoadmapRestored = z.object({ restored: Roadmap, replaced: z.array(Id) })
export type RoadmapRestored = z.infer<typeof RoadmapRestored>

export const ipcInvoke = {
  // App status & settings
  'app.getState': { req: Void, res: AppState },
  'settings.get': { req: Void, res: Settings },
  'settings.update': { req: SettingsPatch, res: Settings },
  /** Stores an API key in the macOS Keychain (Electron safeStorage). Never echoed back. */
  'secrets.set': {
    req: z.object({ key: z.enum(['gemini', 'groq', 'mistral']), value: z.string() }),
    res: Void,
  },
  'profile.get': { req: Void, res: Profile },
  'profile.update': {
    req: Profile.pick({ aboutMe: true, level: true, promptLanguage: true }).partial(),
    res: Profile,
  },
  /** Writes a JSON export of all data and returns its path (shown in Finder by main). */
  'data.export': { req: Void, res: z.object({ path: z.string() }) },
  'data.deleteAll': { req: z.object({ confirm: z.literal(true) }), res: Void },
  'capture.setEnabled': { req: z.boolean(), res: Void },
  'permissions.status': { req: Void, res: PermissionsStatus },
  'permissions.open': { req: z.enum(['accessibility', 'screenRecording']), res: Void },
  /**
   * Clears macOS's entry for this permission and asks again: a switch left from an earlier build
   * looks on but no longer applies. ok false when there is nothing to reset (development).
   */
  'permissions.reset': {
    req: z.enum(['accessibility', 'screenRecording']),
    res: z.object({ ok: z.boolean() }),
  },
  /** Quit and reopen Dumbledore: macOS applies a new Screen Recording grant only after a restart. */
  'app.relaunch': { req: Void, res: Void },
  'providers.test': {
    req: z.enum(['gemini', 'apple', 'groq', 'ovh', 'mistral']),
    res: z.object({
      ok: z.boolean(),
      latencyMs: z.number().nullable(),
      error: z.string().nullable(),
    }),
  },
  'providers.usage': { req: Void, res: UsageSummary },

  // Read models
  'home.get': { req: Void, res: HomeData },
  'subjects.list': { req: Void, res: z.array(SubjectSummary) },
  'subjects.get': { req: Id, res: SubjectDetail },
  'inbox.list': {
    req: z.object({ state: InboxState.nullable(), subjectId: Id.nullable() }),
    res: z.array(Encounter),
  },
  'exams.list': { req: Void, res: z.array(QuizSummary) },
  'search.query': { req: z.string(), res: z.array(SearchHit) },

  // Subjects, inbox, assignments
  'subjects.create': { req: NewSubjectInput, res: Subject },
  'subjects.update': { req: z.object({ id: Id, patch: SubjectPatch }), res: Subject },
  'subjects.delete': { req: z.object({ id: Id, confirm: z.literal(true) }), res: Void },
  'suggested.act': {
    req: z.object({
      subjectId: Id,
      action: z.enum(['accept', 'dismiss', 'merge']),
      intoId: Id.nullable(),
    }),
    res: Void,
  },
  'inbox.act': {
    req: z.object({
      encounterId: Id,
      action: z.enum(['accept', 'ignore', 'assign']),
      subjectId: Id.nullable(),
    }),
    res: Void,
  },
  'assignments.add': { req: NewAssignmentInput, res: Assignment },

  /**
   * Study material: main opens a file picker (PDF, Word, RTF, HTML, text, Markdown), reads each
   * file and files what it teaches into the subject's memory. One result per chosen file; an
   * empty list when the picker was cancelled.
   */
  'materials.add': { req: z.object({ subjectId: Id }), res: z.array(MaterialResult) },

  // Memory control (docs/NOTES.md §7): the topic tree with notes, loose notes, edit and delete
  'subjects.tree': { req: Id, res: SubjectTree },
  'notes.loose': { req: Void, res: z.array(Note) },
  'notes.update': { req: z.object({ id: Id, text: z.string().min(1) }), res: Note },
  'notes.delete': { req: Id, res: Void },
  'notes.file': {
    req: z.object({ id: Id, subjectId: Id, conceptId: Id.nullable() }),
    res: Note,
  },
  'concepts.update': {
    req: z.object({ id: Id, name: z.string().min(1).optional(), summary: z.string().optional() }),
    res: Concept,
  },
  'concepts.delete': { req: Id, res: Void },
  'encounters.delete': { req: Id, res: Void },
  /**
   * "All extracted text" of a topic (Memory page): main writes a text file with everything
   * captured about it (screen text by source, extracted records, notes) and opens it.
   */
  'concepts.openText': { req: Id, res: z.object({ path: z.string() }) },

  /**
   * Roadmap history: a subject's earlier roadmap versions (replaced, never deleted), newest
   * replacement first; and bringing one back by its roadmap id, which moves the current one into
   * the history the same way (restoring that one again undoes it).
   */
  'roadmaps.history': { req: Id, res: z.array(RoadmapVersion) },
  'roadmaps.restore': { req: Id, res: RoadmapRestored },

  // Study session (the shell performs pastes; see StepInstruction)
  'session.get': { req: Void, res: SessionState.nullable() },
  'session.picker': { req: Void, res: PickerData },
  'session.start': { req: StartSessionInput, res: SessionState },
  'session.next': { req: Void, res: SessionState.nullable() },
  'session.end': { req: Void, res: Void },

  // Quizzes & exams
  'quiz.get': { req: Id, res: Quiz },
  'quiz.answer': {
    req: z.object({ quizId: Id, questionId: Id, chosenIndex: z.number().int().min(0).max(3) }),
    res: AnswerResult,
  },
  'quiz.finish': { req: Id, res: QuizResult },
  'exams.create': { req: ExamSpec, res: Quiz },

  // Coach chat, Ask bar, actions
  'chat.history': { req: z.string(), res: z.array(ChatMessage) },
  'chat.send': { req: z.object({ thread: z.string(), text: z.string() }), res: ChatMessage },
  'coach.runAction': { req: CoachAction, res: Void },
  /**
   * `since`: ISO time of the Ask bar's last "New chat"; older messages are not used as context.
   * `subjectId`: the topic selected in the Ask bar; its name and context go to the coach.
   */
  'ask.submit': {
    req: z.object({ text: z.string(), since: z.string().optional(), subjectId: Id.optional() }),
    res: AskResult,
  },
  'nudge.act': {
    req: z.object({ nudgeId: Id, action: z.enum(['accept', 'dismiss', 'snooze']) }),
    res: Void,
  },

  // Prompts
  'prompt.copy': { req: z.string(), res: Void },
  /**
   * Pastes into the open AI chat. With none open it opens and copies nothing: `ok: false`,
   * `reason: 'no-chat'` and `usual` (the AI the student usually studies with, or null), so the
   * caller can offer "Open <usual> and paste" / "Copy" — a website opens only on that click.
   * `opened` is always null now (kept for older callers).
   */
  'prompt.sendToChat': {
    req: z.string(),
    res: z.object({
      ok: z.boolean(),
      reason: z.string().nullable(),
      opened: z.object({ name: z.string(), prefilled: z.boolean() }).nullable().optional(),
      usual: z.object({ name: z.string() }).nullable().optional(),
    }),
  },
  /**
   * The explicit "Open <usual AI> and paste" button: copies the prompt and opens the student's
   * usual AI in the browser (typed in where the site allows, never sent). `opened: null` when
   * Dumbledore doesn't know one (nothing opens then). Only ever called from a click on a button
   * that says it opens the AI.
   */
  'prompt.openUsualAi': {
    req: z.string(),
    res: z.object({
      opened: z.object({ name: z.string(), prefilled: z.boolean() }).nullable(),
    }),
  },
  /**
   * The prompt box (right ⌥ hold): Dumbledore writes a prompt from what the student asked for and
   * pastes it into the AI chat box (the ask bar closes before the paste). `pasted: false`: copied.
   */
  'prompt.write': {
    req: z.object({ context: z.string().min(1) }),
    res: z.object({ pasted: z.boolean(), prompt: z.string() }),
  },

  // Overlay & windows
  'overlay.getState': { req: Void, res: OverlayState },
  'overlay.action': { req: OverlayAction, res: Void },
  'window.open': {
    req: z.object({ surface: WindowSurface, route: z.string().nullable() }),
    res: Void,
  },
  'window.close': { req: WindowSurface, res: Void },
  'window.setSize': {
    req: z.object({ surface: z.enum(['panel', 'askbar']), width: z.number(), height: z.number() }),
    res: Void,
  },
} as const

export const ipcEvents = {
  'state.changed': AppState,
  'overlay.changed': OverlayState,
  'memory.changed': MemoryChanged,
  'session.changed': SessionState.nullable(),
  'chat.delta': z.object({
    thread: z.string(),
    messageId: Id,
    delta: z.string(),
    done: z.boolean(),
  }),
  /** Main asks a window to show a route (e.g. open the app on an exam). */
  navigate: z.object({ route: z.string() }),
  /** Trigger-key gestures, forwarded to the app window (onboarding teaches the key with it). */
  'key.gesture': z.object({
    gesture: z.enum(['tap', 'doubleTap', 'holdStart', 'holdEnd']),
    key: z.string(),
  }),
} as const

export type InvokeChannel = keyof typeof ipcInvoke
export type InvokeReq<C extends InvokeChannel> = z.input<(typeof ipcInvoke)[C]['req']>
export type InvokeRes<C extends InvokeChannel> = z.output<(typeof ipcInvoke)[C]['res']>
export type EventChannel = keyof typeof ipcEvents
export type EventPayload<E extends EventChannel> = z.output<(typeof ipcEvents)[E]>

/** Arguments tuple: channels whose request is void take no argument. */
export type InvokeArgs<C extends InvokeChannel> = [InvokeReq<C>] extends [void]
  ? []
  : [InvokeReq<C>]

/** The API the preload exposes as `window.dumbledore`. */
export interface DumbledoreApi {
  surface: 'overlay' | 'panel' | 'askbar' | 'app'
  invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeRes<C>>
  on<E extends EventChannel>(event: E, listener: (payload: EventPayload<E>) => void): () => void
}

export { IPC_EVENT_PREFIX, IPC_INVOKE_PREFIX } from './ipc-names'
