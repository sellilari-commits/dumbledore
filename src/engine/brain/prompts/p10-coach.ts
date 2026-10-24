/**
 * P10 Coach (tier `chat`, tools): the panel / Ask-bar chat persona plus the seven action tools
 * (start_roadmap, create_exam, start_review, insert_prompt, set_focus, open_subject,
 * adjust_roadmap) and the
 * mapping from a model tool call to a validated CoachAction. Text only — no schema — because
 * Groq cannot combine tools with a response schema.
 */
import type { CoachInput } from '@engine/brain-contract'
import { CoachAction } from '@shared/domain'
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
