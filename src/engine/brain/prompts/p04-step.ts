/**
 * P4 Step writer (tier `write`, latency-critical): turns a roadmap step's draft into the prompt
 * pasted into the student's AI, adapted to what just happened in the chat, plus a one-line coach
 * tip and memory updates read from the chat (the step writer's "remember" channel).
 */
import {
  type StepInput,
  type StepOutput,
  StepOutput as StepOutputSchema,
} from '@engine/brain-contract'
import { UnderstandingStatus } from '@shared/domain'
import { clipTail, looksFinnish } from '../llm/text'
import {
  bullets,
  checkStudentPrompt,
  limitWords,
  type PromptSpec,
  studentPromptRules,
  tag,
  tidyStudentPrompt,
} from './shared'

export function stepLanguage(input: StepInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(`${input.step.promptDraft}\n${input.chatExcerpt}`) ? 'fi' : 'en'
}

function system(input: StepInput, lang: string): string {
  const a = input.assistant || 'their AI assistant'
  return `You write the exact message a student will paste into ${a} for the current step of their study roadmap. Start from the draft and adapt it to what just happened in the chat:
- If the student asked a follow-up or seemed confused in the last exchange, address that first, in one clause ("I still don't get why…").
- If a concept was missed in a checkpoint (<misses>), target the misconception directly ("I thought X — explain why that's wrong.").
- Don't repeat what the chat already covered; build on it ("You explained A; now…").
- Keep the step's objective and teaching move. If the chat is empty, polish the draft.

${studentPromptRules(a, lang)}

Also return:
- coachTip: one sentence (≤ 20 words) telling the student which prompting technique this prompt uses and why it works, e.g. "Asking to be quizzed turns reading into recall — that is what makes it stick."
- memoryUpdates: at most 5 facts from <chat> worth remembering: type "understanding" (value = understood, unclear or struggling; evidence = a short quote), "note" (something the student now knows or did) or "question" (something the student still wants to know). [] when the chat shows nothing new. Never invent.`
}

function user(input: StepInput): string {
  const misses = input.recentMisses.map((m) => `${m.concept}: ${m.misconception}`)
  return [
    tag('student', input.profile || '(no profile)'),
    tag('step', `objective: ${input.step.objective}\ndraft: ${input.step.promptDraft}`, {
      title: input.step.title,
      move: input.step.move,
    }),
    tag(
      'chat',
      input.chatExcerpt.trim() ? clipTail(input.chatExcerpt, 1800) : '(empty — nothing sent yet)',
    ),
    tag('misses', bullets(misses)),
  ].join('\n')
}

export const stepPrompt: PromptSpec<StepInput, StepOutput, StepOutput> = {
  id: 'P4',
  task: 'writeStep',
  version: 1,
  tier: 'write',
  temperature: 0.5,
  maxOutputTokens: 900,
  reasoningEffort: 'low',
  schemaName: 'step_prompt',
  schema: StepOutputSchema,
  onDeviceOk: false,
  cacheable: true,
  language: stepLanguage,
  build: (input) => ({ system: system(input, stepLanguage(input)), user: user(input) }),
  check: (out) => checkStudentPrompt(out.prompt).filter((i) => !i.includes('brevity rule')),
  finalize(out, input) {
    const statuses = new Set<string>(UnderstandingStatus.options)
    return {
      prompt: tidyStudentPrompt(out.prompt, stepLanguage(input)),
      coachTip: limitWords(out.coachTip, 25),
      memoryUpdates: out.memoryUpdates
        .filter((m) => m.concept.trim() && m.value.trim())
        .filter((m) => m.type !== 'understanding' || statuses.has(m.value.trim()))
        .slice(0, 5)
        .map((m) => ({
          ...m,
          concept: m.concept.trim(),
          value: m.value.trim(),
          evidence: m.evidence.trim(),
        })),
    }
  },
}
