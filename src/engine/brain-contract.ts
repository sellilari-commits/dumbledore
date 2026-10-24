/**
 * The Brain: every LLM-backed capability the engine uses, as typed inputs and outputs.
 *
 * Lane L2 implements it (prompts P1–P12 in docs/PLAN.md, Appendix A). Every other lane depends
 * only on this interface and uses `FakeBrain` (engine/testing) in tests.
 */

import {
  type CoachAction,
  EpisodeKind,
  EpisodeSignals,
  ExamSpec,
  MasteryStatus,
  NoteKind,
  Probe,
  TeachingMove,
  UnderstandingStatus,
} from '@shared/domain'
import { z } from 'zod'

const Lang = z.string() // BCP-47-ish: "en", "fi", … or "auto"

// ─── P1 Extractor ───────────────────────────────────────────────────────────────────────────

// ─── P0 Triage ──────────────────────────────────────────────────────────────────────────────

/** A window of the last few minutes, one short excerpt per episode, judged together. */
export const TriageInput = z.object({
  language: Lang,
  episodes: z.array(
    z.object({
      id: z.string(),
      kind: EpisodeKind,
      app: z.string(),
      title: z.string().nullable(),
      url: z.string().nullable(),
      dwellSeconds: z.number(),
      signals: EpisodeSignals,
      /** About 300 characters of cleaned, redacted text. */
      excerpt: z.string(),
    }),
  ),
})
export type TriageInput = z.infer<typeof TriageInput>

/** One answer per input episode, in input order; null = the model gave none (caller falls back). */
export const TriageOutput = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      hasLearnableContent: z.boolean().nullable(),
      reason: z.string(),
    }),
  ),
})
export type TriageOutput = z.infer<typeof TriageOutput>

export const ExtractInput = z.object({
  student: z.object({ aboutMe: z.string(), language: Lang }),
  subjects: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      topConcepts: z.array(z.string()),
      /** The subject's concept tree, compact (≤ 60, most recent and most used first), so the
       * model can place notes on it (docs/NOTES.md §4). */
      concepts: z
        .array(z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() }))
        .optional(),
    }),
  ),
  episodes: z.array(
    z.object({
      id: z.string(),
      app: z.string(),
      url: z.string().nullable(),
      title: z.string().nullable(),
      kind: EpisodeKind,
      aiProvider: z.string().nullable(),
      dwellSeconds: z.number(),
      signals: EpisodeSignals,
      text: z.string(), // cleaned + redacted; lines may carry [L]/[C]/[R] alignment tags
    }),
  ),
  /** What else the student had open in the same few minutes (titles), as context only. */
  context: z.array(z.string()).optional(),
})
export type ExtractInput = z.infer<typeof ExtractInput>

export const ExtractedItem = z.object({
  subject: z.object({ matchId: z.string().nullable(), newName: z.string().nullable() }),
  topicPath: z.array(z.string()).min(1).max(4),
  seen: z.string(),
  bigPicture: z.string(),
  understanding: z.object({ status: UnderstandingStatus, evidence: z.string() }),
  openQuestions: z.array(z.string()).max(3),
  keyTerms: z.array(z.string()),
  assignment: z
    .object({ title: z.string(), course: z.string().nullable(), dueAt: z.string().nullable() })
    .nullable(),
  /**
   * 1–5 atomic notes, placed by the model on the subject's tree: `conceptId` of an existing
   * concept, or `newConcept` under a parent (null = top level). Ids are not validated here;
   * apply.ts checks them and falls back to the topicPath name match.
   */
  notes: z
    .array(
      z.object({
        text: z.string(),
        keywords: z.array(z.string()),
        conceptId: z.string().nullable(),
        newConcept: z.object({ name: z.string(), parentId: z.string().nullable() }).nullable(),
      }),
    )
    .optional(),
})
export type ExtractedItem = z.infer<typeof ExtractedItem>

export const ExtractOutput = z.object({
  results: z.array(
    z.object({
      episodeId: z.string(),
      isLearning: z.boolean(),
      confidence: z.number().min(0).max(1),
      reason: z.string(),
      items: z.array(ExtractedItem),
      /** The student's own prompts seen in an AI chat, scored for coaching (P1 for ai_chat). */
      studentPrompts: z.array(
        z.object({
          text: z.string(),
          hasContext: z.boolean(),
          hasStructure: z.boolean(),
          asksToBeQuizzed: z.boolean(),
          asksForExamples: z.boolean(),
        }),
      ),
    }),
  ),
})
export type ExtractOutput = z.infer<typeof ExtractOutput>

// ─── P13 Consolidation ──────────────────────────────────────────────────────────────────────

/** One subject's tree and notes for the restructuring pass (docs/NOTES.md §5). */
export const ConsolidateInput = z.object({
  subject: z.object({ id: z.string(), name: z.string(), goal: z.string().nullable() }),
  language: Lang,
  concepts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      parentId: z.string().nullable(),
      summary: z.string(),
      status: MasteryStatus,
      mastery: z.number(),
    }),
  ),
  notes: z.array(
    z.object({
      id: z.string(),
      conceptId: z.string().nullable(),
      kind: NoteKind,
      text: z.string(),
      /** Edited by the student: never rewritten, merged or moved. */
      pinned: z.boolean(),
      /** Where the note was read (page title, else app), so pages about one thing unite. */
      source: z.string().optional(),
    }),
  ),
  edges: z.array(z.object({ fromId: z.string(), toId: z.string() })),
  /** The student's other subjects, so a concept filed under the wrong one can move there. */
  otherSubjects: z.array(z.object({ id: z.string(), name: z.string() })).optional(),
})
export type ConsolidateInput = z.infer<typeof ConsolidateInput>

/** The model's proposals, ids mapped back; consolidate/apply.ts validates every one. */
export const ConsolidateOutput = z.object({
  summaries: z.array(z.object({ conceptId: z.string(), summary: z.string() })),
  mergeConcepts: z.array(z.object({ fromId: z.string(), intoId: z.string() })),
  mergeNotes: z.array(
    z.object({ fromId: z.string(), intoId: z.string(), text: z.string().nullable() }),
  ),
  /** The subject's top level: 3–9 topics, each an existing concept or a new name, with children. */
  topics: z.array(
    z.object({
      conceptId: z.string().nullable(),
      name: z.string(),
      children: z.array(z.string()),
    }),
  ),
  placeNotes: z.array(z.object({ noteId: z.string(), conceptId: z.string() })),
  edges: z.array(z.object({ fromId: z.string(), toId: z.string(), why: z.string() })),
  openQuestions: z.array(z.object({ conceptId: z.string().nullable(), question: z.string() })),
  /** A concept that belongs to another of the student's subjects → that subject (validated). */
  moveConcepts: z.array(z.object({ conceptId: z.string(), subjectId: z.string() })).optional(),
})
export type ConsolidateOutput = z.infer<typeof ConsolidateOutput>

// ─── P14 Study preferences ──────────────────────────────────────────────────────────────────

/** The student's words about a subject's roadmap, to map onto its concept tree. */
export const PreferencesInput = z.object({
  subject: z.object({ name: z.string(), goal: z.string().nullable() }),
  language: Lang,
  concepts: z.array(
    z.object({ id: z.string(), name: z.string(), parentId: z.string().nullable() }),
  ),
  current: z.object({ focus: z.array(z.string()), skip: z.array(z.string()) }),
  instruction: z.string(),
})
export type PreferencesInput = z.infer<typeof PreferencesInput>

/** Concept ids (unvalidated) plus wishes that match no concept; `replace` = start over. */
export const PreferencesOutput = z.object({
  replace: z.boolean(),
  focus: z.array(z.string()),
  skip: z.array(z.string()),
  focusNames: z.array(z.string()),
  skipNames: z.array(z.string()),
})
export type PreferencesOutput = z.infer<typeof PreferencesOutput>

// ─── P3 Roadmapper ──────────────────────────────────────────────────────────────────────────

export const RoadmapInput = z.object({
  goal: z.string(),
  subject: z.object({ id: z.string(), name: z.string() }).nullable(),
  deadline: z.string().nullable(),
  minutesAvailable: z.number().nullable(),
  assistant: z.string(), // "ChatGPT"
  language: Lang,
  profile: z.string(),
  mastery: z.array(z.object({ concept: z.string(), status: MasteryStatus, evidence: z.string() })),
  encounters: z.array(
    z.object({ seen: z.string(), bigPicture: z.string(), understanding: UnderstandingStatus }),
  ),
  openQuestions: z.array(z.string()),
  doneSteps: z.array(z.string()),
  carry: z.array(z.string()),
  /** The subject's structure from notes consolidation (docs/NOTES.md §6); all optional. */
  tree: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        parentId: z.string().nullable(),
        status: MasteryStatus,
        mastery: z.number(),
        /** For a topic: its big picture across all its sources. */
        summary: z.string(),
        /** Titles of the pages this concept (and its subtree) was read in, newest first. */
        sources: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  /** Prerequisites by concept id: `fromId` comes before `toId`. */
  edges: z.array(z.object({ fromId: z.string(), toId: z.string() })).optional(),
  /** Up to 3 notes per concept (highlights and the student's own edits first). */
  keyNotes: z.array(z.object({ conceptId: z.string(), text: z.string() })).optional(),
  /** Concept names in the order to teach, computed in code: prerequisites first, mastered skipped. */
  suggestedOrder: z.array(z.string()).optional(),
  /** What the student said this roadmap should and should not cover (adjust_roadmap). */
  preferences: z
    .object({ instruction: z.string(), focus: z.array(z.string()), skip: z.array(z.string()) })
    .optional(),
})
export type RoadmapInput = z.infer<typeof RoadmapInput>

export const PlannedLearn = z.object({
  kind: z.literal('learn'),
  title: z.string(),
  objective: z.string(),
  concepts: z.array(z.string()).min(1),
  move: TeachingMove,
  promptDraft: z.string(),
})
export const PlannedCheckpoint = z.object({
  kind: z.literal('checkpoint'),
  covers: z.array(z.string()).min(1),
  probes: z.array(Probe),
  nQuestions: z.number().int().min(1).max(5),
})
export const RoadmapPlan = z.object({
  title: z.string(),
  goal: z.string(),
  startReason: z.string(),
  offerPlacement: z.boolean(),
  estimatedMinutes: z.number(),
  items: z.array(z.discriminatedUnion('kind', [PlannedLearn, PlannedCheckpoint])).min(2),
  nextMilestone: z.string().nullable(),
})
export type RoadmapPlan = z.infer<typeof RoadmapPlan>

// ─── P4 Step writer ─────────────────────────────────────────────────────────────────────────

export const MemoryUpdate = z.object({
  type: z.enum(['understanding', 'note', 'question']),
  concept: z.string(),
  value: z.string(), // for 'understanding': one of UnderstandingStatus
  evidence: z.string(),
})
export type MemoryUpdate = z.infer<typeof MemoryUpdate>

export const StepInput = z.object({
  assistant: z.string(),
  language: Lang,
  profile: z.string(),
  step: z.object({
    title: z.string(),
    objective: z.string(),
    move: TeachingMove,
    promptDraft: z.string(),
  }),
  chatExcerpt: z.string(), // what is visible in the AI chat now (OCR/AX), roles inferred
  recentMisses: z.array(Probe),
})
export type StepInput = z.infer<typeof StepInput>

export const StepOutput = z.object({
  prompt: z.string(),
  coachTip: z.string(),
  memoryUpdates: z.array(MemoryUpdate),
})
export type StepOutput = z.infer<typeof StepOutput>

// ─── P5 Checkpoint quizmaster + verifier, P6 exam builder ──────────────────────────────────

export const QuestionDraft = z.object({
  concept: z.string(),
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  rationales: z.array(z.string()).length(4),
  difficulty: z.number().int().min(1).max(3),
})
export type QuestionDraft = z.infer<typeof QuestionDraft>

export const CheckpointInput = z.object({
  concepts: z.array(z.string()).min(1),
  probes: z.array(Probe),
  carry: z.array(z.string()),
  n: z.number().int().min(1).max(5),
  studied: z.string(), // excerpts of what the AI explained
  language: Lang,
})
export type CheckpointInput = z.infer<typeof CheckpointInput>

export const VerifyResult = z.object({
  index: z.number().int(),
  chosen: z.number().int().min(0).max(3),
  confidence: z.number().min(0).max(1),
})
export type VerifyResult = z.infer<typeof VerifyResult>

export const ExamInput = z.object({
  /** `goal`: what the student is working towards; steers the topics while none are known. */
  subjects: z.array(z.object({ id: z.string(), name: z.string(), goal: z.string().nullish() })),
  spec: ExamSpec,
  concepts: z.array(z.object({ name: z.string(), status: MasteryStatus, mastery: z.number() })),
  encounters: z.array(z.object({ seen: z.string(), bigPicture: z.string() })),
  language: Lang,
})
export type ExamInput = z.infer<typeof ExamInput>

// ─── P15 Outline ─────────────────────────────────────────────────────────────────────────────

/** A page the student reads (PDF, article) as numbered lines, plus what they need from it. */
export const OutlineInput = z.object({
  subject: z.object({ name: z.string(), goal: z.string().nullable() }),
  page: z.object({ title: z.string().nullable(), app: z.string() }),
  /** Concepts the student struggles with or hasn't got yet, with why. */
  gaps: z.array(z.object({ name: z.string(), why: z.string() })),
  /** Concepts already mastered: their passages can be skimmed or skipped. */
  known: z.array(z.string()),
  openQuestions: z.array(z.string()),
  lines: z.array(z.object({ i: z.number().int(), text: z.string() })),
  language: Lang,
})
export type OutlineInput = z.infer<typeof OutlineInput>

export const OutlineVerdict = z.enum(['read', 'skim', 'skip'])
export type OutlineVerdict = z.infer<typeof OutlineVerdict>

export const OutlineOutput = z.object({
  /** One sentence: what this page gives the student for their goal. */
  summary: z.string(),
  /** Line ranges (inclusive), in page order, never overlapping. Lines not covered are left as-is. */
  ranges: z.array(
    z.object({
      from: z.number().int(),
      to: z.number().int(),
      verdict: OutlineVerdict,
      /** ≤ 8 words, e.g. "Your gap: carbocation stability". */
      why: z.string(),
    }),
  ),
})
export type OutlineOutput = z.infer<typeof OutlineOutput>

// ─── P7 Gap fixer ───────────────────────────────────────────────────────────────────────────

export const GapInput = z.object({
  assistant: z.string(),
  language: Lang,
  profile: z.string(),
  misses: z.array(
    z.object({
      concept: z.string(),
      stem: z.string(),
      chosen: z.string(),
      correct: z.string(),
      rationale: z.string(),
    }),
  ),
})
export type GapInput = z.infer<typeof GapInput>

export const GapOutput = z.object({
  diagnoses: z.array(Probe),
  prompt: z.string(),
  nextTopic: z.string(),
})
export type GapOutput = z.infer<typeof GapOutput>

// ─── P8 Prompt improver, P9 Suggester ──────────────────────────────────────────────────────

export const ImproveInput = z.object({
  assistant: z.string(),
  language: Lang,
  profile: z.string(),
  draft: z.string(),
  context: z.string(), // current page / session, short
})
export type ImproveInput = z.infer<typeof ImproveInput>

export const PromptWithTip = z.object({ prompt: z.string(), coachTip: z.string() })
export type PromptWithTip = z.infer<typeof PromptWithTip>

export const SuggestCandidate = z.object({
  kind: z.enum([
    'session_step',
    'open_question',
    'struggling',
    'due_review',
    'deadline',
    'starter',
  ]),
  text: z.string(),
})
export type SuggestCandidate = z.infer<typeof SuggestCandidate>

export const SuggestInput = z.object({
  assistant: z.string(),
  language: Lang,
  profile: z.string(),
  candidates: z.array(SuggestCandidate).min(1),
  context: z.string(),
})
export type SuggestInput = z.infer<typeof SuggestInput>

export const SuggestOutput = PromptWithTip.extend({ basedOn: SuggestCandidate.shape.kind })
export type SuggestOutput = z.infer<typeof SuggestOutput>

// ─── P10 Coach, P11 Nudge writer, P12 Profiler ─────────────────────────────────────────────

export const CoachInput = z.object({
  profile: z.string(),
  context: z.string(), // subjects, mastery, due, session, recent activity — compact text
  history: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
  message: z.string(),
})
export type CoachInput = z.infer<typeof CoachInput>

export type CoachEvent =
  | { type: 'text'; delta: string }
  | { type: 'action'; action: CoachAction }
  | { type: 'done' }

export const NudgeInput = z.object({ kind: z.string(), facts: z.string(), language: Lang })
export type NudgeInput = z.infer<typeof NudgeInput>
export const NudgeOutput = z.object({ title: z.string(), body: z.string() })
export type NudgeOutput = z.infer<typeof NudgeOutput>

export const ProfileInput = z.object({
  aboutMe: z.string(),
  subjects: z.string(),
  struggles: z.string(),
  habits: z.string(),
})
export type ProfileInput = z.infer<typeof ProfileInput>
export const ProfileOutput = z.object({
  summary: z.string(),
  level: z.string().nullable(),
  habitsToCoach: z.array(z.string()),
})
export type ProfileOutput = z.infer<typeof ProfileOutput>

// ─── The interface ──────────────────────────────────────────────────────────────────────────

export interface CallOptions {
  signal?: AbortSignal
  /** Hard deadline; on timeout the call rejects with BrainTimeoutError. */
  timeoutMs?: number
}

export class BrainTimeoutError extends Error {
  constructor(task: string) {
    super(`brain task "${task}" timed out`)
    this.name = 'BrainTimeoutError'
  }
}

export class BrainUnavailableError extends Error {
  constructor(task: string, reason: string) {
    super(`brain task "${task}" unavailable: ${reason}`)
    this.name = 'BrainUnavailableError'
  }
}

export interface Brain {
  /** P0: cheap yes/no "learnable content?" for a window of episodes, judged together. */
  triage(input: TriageInput, opts?: CallOptions): Promise<TriageOutput>
  extract(input: ExtractInput, opts?: CallOptions): Promise<ExtractOutput>
  /** P13: restructure one subject's notes and concept tree (summaries, merges, topics, edges). */
  consolidate(input: ConsolidateInput, opts?: CallOptions): Promise<ConsolidateOutput>
  /** P14: maps "on this subject I want X, not Y" onto the subject's concept tree. */
  mapPreferences(input: PreferencesInput, opts?: CallOptions): Promise<PreferencesOutput>
  buildRoadmap(input: RoadmapInput, opts?: CallOptions): Promise<RoadmapPlan>
  writeStep(input: StepInput, opts?: CallOptions): Promise<StepOutput>
  makeCheckpoint(input: CheckpointInput, opts?: CallOptions): Promise<QuestionDraft[]>
  /** Blind-answers each question; callers compare `chosen` with the key. */
  verifyQuestions(questions: QuestionDraft[], opts?: CallOptions): Promise<VerifyResult[]>
  makeExam(input: ExamInput, opts?: CallOptions): Promise<QuestionDraft[]>
  fixGaps(input: GapInput, opts?: CallOptions): Promise<GapOutput>
  improvePrompt(input: ImproveInput, opts?: CallOptions): Promise<PromptWithTip>
  suggestPrompt(input: SuggestInput, opts?: CallOptions): Promise<SuggestOutput>
  coach(input: CoachInput, opts?: CallOptions): AsyncIterable<CoachEvent>
  writeNudge(input: NudgeInput, opts?: CallOptions): Promise<NudgeOutput>
  buildProfile(input: ProfileInput, opts?: CallOptions): Promise<ProfileOutput>
  /** P15: which passages of the page being read to read / skim / skip for the student's gaps. */
  outline(input: OutlineInput, opts?: CallOptions): Promise<OutlineOutput>
}
