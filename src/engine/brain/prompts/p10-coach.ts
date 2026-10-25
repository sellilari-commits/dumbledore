/**
 * P10 Coach (tier `chat`, tools): the panel / Ask-bar chat persona plus the eleven action tools
 * (start_roadmap, create_exam, start_review, insert_prompt, set_focus, open_subject,
 * adjust_roadmap, add_note, save_question, update_subject, give_feedback) and the
 * mapping from a model tool call to a validated CoachAction. Text only — no schema — because
 * Groq cannot combine tools with a response schema.
 */
import type { CoachInput } from '@engine/brain-contract'
import { CoachAction, FeedbackScope } from '@shared/domain'
import { z } from 'zod'
import { toProviderSchema } from '../llm/json'
import { clip } from '../llm/text'
import type { ChatTurn, ToolDef } from '../llm/types'
import { brevityRule, tag } from './shared'

const ToolInputs = {
  start_roadmap: z.object({
    goal: z.string().describe('What the student wants to understand, in their words'),
    subjectId: z
      .string()
      .nullable()
      .describe('Id of the matching subject from the context, or null'),
  }),
  create_exam: z.object({
    subjectIds: z.array(z.string()).describe('Subject ids from the context'),
    count: z.number().int().describe('5, 10 or 20'),
    focus: z.enum(['weak', 'due', 'everything']),
    difficulty: z.enum(['mixed', 'easy', 'hard']),
  }),
  start_review: z.object({
    conceptIds: z.array(z.string()).describe('Concept ids from the context'),
  }),
  insert_prompt: z.object({
    text: z.string().describe('The prompt to paste into the student’s AI chat box'),
  }),
  set_focus: z.object({
    subjectId: z.string().nullable().describe('Subject id to focus on, or null to clear'),
  }),
  open_subject: z.object({ subjectId: z.string() }),
  adjust_roadmap: z.object({
    subjectId: z.string().describe('Id of the subject from the context'),
    instruction: z
      .string()
      .describe('What the roadmap should cover or skip, in the student’s words'),
  }),
  add_note: z.object({
    text: z.string().describe('The note in the student’s words, ≤ 200 characters'),
    subjectId: z
      .string()
      .nullable()
      .describe('Subject id from the context when the note names another subject, else null'),
    conceptId: z
      .string()
      .nullable()
      .describe('conceptId of the topic from the context it belongs to, else null (current topic)'),
  }),
  save_question: z.object({
    text: z
      .string()
      .describe('What the student asked or does not get, in their words, ≤ 200 characters'),
    conceptId: z
      .string()
      .nullable()
      .describe('Id of the topic from the context it is about, else null'),
    topic: z
      .string()
      .nullable()
      .describe('The topic’s name in 1–5 words when it has no id in the context, else null'),
    subjectId: z.string().nullable().describe('Id of the subject from the context, else null'),
    stuck: z
      .boolean()
      .describe('true when they say they don’t understand it or keep getting it wrong'),
  }),
  update_subject: z.object({
    subjectId: z.string().describe('Id of the subject from the context'),
    goal: z.string().nullable().describe('Their goal for the subject in their words, else null'),
    deadline: z.string().nullable().describe('Exam or deadline date as YYYY-MM-DD, else null'),
    scope: z
      .string()
      .nullable()
      .describe('What the course covers, in their words (≤ 300 characters), else null'),
  }),
  give_feedback: z.object({
    text: z.string().describe('The feedback in the student’s words, one sentence'),
    scope: FeedbackScope.describe(
      'study_plan (roadmaps), quizzes, prompts (written prompts), memory (what you note or remember), general',
    ),
    subjectId: z.string().nullable().describe('Subject id when it is about one subject, else null'),
  }),
} as const

type ToolName = keyof typeof ToolInputs

const DESCRIPTIONS: Record<ToolName, string> = {
  start_roadmap:
    'Build a step-by-step study roadmap for something the student wants to learn or understand (works even with no prior record).',
  create_exam:
    'Create a practice exam (5, 10 or 20 multiple-choice questions) for one or more subjects.',
  start_review: 'Start a short spaced-review quiz on specific concepts.',
  insert_prompt:
    "Paste a prompt into the student's open AI chat box (it is not sent; they review it first).",
  set_focus: 'Set (or clear) the subject Dumbledore should focus on.',
  open_subject: "Open a subject's page in the app.",
  adjust_roadmap:
    "Change what a subject's roadmap covers: focus on or skip topics, go deeper or lighter, in the student's words. The roadmap is planned again; nothing is pasted.",
  add_note:
    'Save a note the student wants to keep (a fact, definition, reminder or their own summary). It is saved at once on the right topic; they can undo it.',
  save_question:
    'Save what the student asked or does not understand as an open question on the topic (and mark it as a gap when they are stuck). Saved at once; their prompts, outlines and roadmaps then aim at it.',
  update_subject:
    "Save a fact about one of the student's subjects: their goal, the exam or deadline date, or what the course covers. Saved at once; they can undo it.",
  give_feedback:
    'Store feedback about Dumbledore itself (its study plans, quizzes, prompts or what it remembers) so later answers follow it.',
}

export const COACH_TOOLS: ToolDef[] = (Object.keys(ToolInputs) as ToolName[]).map((name) => ({
  name,
  description: DESCRIPTIONS[name],
  parameters: toProviderSchema(ToolInputs[name]),
}))

const snapCount = (n: number): 5 | 10 | 20 => (n <= 7 ? 5 : n <= 14 ? 10 : 20)

/** Validated CoachAction for a tool call, or null when the call is unusable. */
export function toCoachAction(name: string, input: unknown): CoachAction | null {
  if (!(name in ToolInputs)) return null
  const tool = name as ToolName
  const parsed = ToolInputs[tool].safeParse(input)
  if (!parsed.success) return null
  const v = parsed.data as Record<string, unknown>
  let action: unknown
  switch (tool) {
    case 'start_roadmap':
      action = { type: tool, goal: v.goal, subjectId: v.subjectId || null }
      break
    case 'create_exam':
      action = {
        type: tool,
        spec: {
          subjectIds: v.subjectIds,
          count: snapCount(Number(v.count)),
          focus: v.focus,
          difficulty: v.difficulty,
        },
      }
      break
    case 'start_review':
      action = { type: tool, conceptIds: v.conceptIds }
      break
    case 'insert_prompt':
      action = { type: tool, text: v.text }
      break
    case 'set_focus':
      action = { type: tool, subjectId: v.subjectId || null }
      break
    case 'open_subject':
      action = { type: tool, subjectId: v.subjectId }
      break
    case 'adjust_roadmap':
      action = { type: tool, subjectId: v.subjectId, instruction: v.instruction }
      break
    case 'add_note':
      action = {
        type: tool,
        text: v.text,
        subjectId: v.subjectId || null,
        conceptId: v.conceptId || null,
      }
      break
    case 'save_question':
      action = {
        type: tool,
        text: v.text,
        conceptId: v.conceptId || null,
        topic: v.topic || null,
        subjectId: v.subjectId || null,
        stuck: v.stuck === true,
      }
      break
    case 'update_subject': {
      const date = typeof v.deadline === 'string' ? v.deadline.trim().slice(0, 10) : ''
      action = {
        type: tool,
        subjectId: v.subjectId,
        goal: v.goal || null,
        deadline: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null,
        scope: v.scope || null,
      }
      break
    }
    case 'give_feedback':
      action = { type: tool, text: v.text, scope: v.scope, subjectId: v.subjectId || null }
      break
  }
  const ok = CoachAction.safeParse(action)
  return ok.success ? ok.data : null
}

export function coachSystem(input: CoachInput): string {
  return `You are Dumbledore: a calm, warm, wise learning coach who lives on the student's Mac. Speak briefly (≤ 80 words unless asked for more), plainly, and always end with a concrete next step. No wizard or movie references. Never do the student's assignments for them; help them learn by using AI tools well.

You know the learner profile, their subjects with mastery and deadlines, due reviews, the active study session and what they looked at recently (below). Never invent progress data, subjects or ids; if you don't know, say so.

- "What should I focus on?" → rank by deadline proximity, then struggling concepts, then due reviews, then momentum; give the top 1–3 with a one-line reason each and offer the matching action.
- When they want to understand or learn something — even something you have no record of — call start_roadmap first (one short sentence, then the tool call).
- When they say what to focus on or skip in a subject ("on chemistry I want SN1, not SN2", "skip the history part"), call adjust_roadmap with that subject's id and their wish in their words.
- If the context says "Mode: chat", this is a conversation with you: nothing is pasted into their AI chat, so never call insert_prompt; offer the other actions instead.
- When the student writes something to keep — "remember that …", "note that …", a fact, definition or summary in their own words meant as a note, not a question — call add_note at once (no need to ask), then answer in one short sentence. Leave subjectId and conceptId null for the current topic; use the ids of another topic or subject from the context only when the note is clearly about it.
- When they ask a question about what they study or say they don't get something ("I don't get carbocations", "why is SN1 two steps?"), answer it and also call save_question: their words, the topic's id from the context (or its name as topic when it has none), stuck: true when they say they don't understand it or keep getting it wrong. Don't for small talk or questions about you.
- When they state a fact about one of their subjects — the exam or deadline date, their goal, what the course covers ("my exam is on 12 December", "I need to pass the midterm", "the course is reactions and mechanisms") — call update_subject for that subject at once (dates as YYYY-MM-DD from "Today" in the context), then confirm in one short sentence.
- Everything you save shows the student a receipt with Undo, so save without asking; never claim you saved something without calling the tool.
- When the student gives feedback about you — your study plans, quizzes, prompts or what you note ("your quizzes are too easy", "I prefer short prompts", "stop asking me about X", "this topic is wrong") — call give_feedback with the right scope and reply "Got it, I'll …" saying what changes. A wish about what one subject's roadmap covers is adjust_roadmap (also call give_feedback with scope study_plan only for a general preference about all study plans).
- Act through the tools. Use ids exactly as written in the context. Call a tool only when the student asked for it or clearly agreed, except start_roadmap for learning requests.
- A prompt you insert is written as the student, in first person: one line of their context, a short numbered ask, the sentence "${brevityRule('en')}" (in the student's language), ≤ 110 words.
- Plain text; short bullet lists are fine; no markdown headings. Answer in the student's language.

${tag('profile', input.profile || '(no profile yet)')}
${tag('context', clip(input.context || '(nothing recorded yet)', 6000))}`
}

export function coachMessages(input: CoachInput): ChatTurn[] {
  const history = input.history
    .slice(-12)
    .map((m) => ({ role: m.role, content: clip(m.content, 2000) }))
  return [...history, { role: 'user' as const, content: input.message }]
}
