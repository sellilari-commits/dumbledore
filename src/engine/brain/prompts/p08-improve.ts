/**
 * P8 Prompt improver (tier `write`): rewrites the student's own draft so it makes them learn —
 * same intent, plus a context line, structure, the brevity rule and (when they are learning a
 * concept) an active-learning hook — and says in one line what changed.
 */
import {
  type ImproveInput,
  type PromptWithTip,
  PromptWithTip as PromptWithTipSchema,
} from '@engine/brain-contract'
import { clip, looksFinnish } from '../llm/text'
import {
  checkStudentPrompt,
  limitWords,
  type PromptSpec,
  studentPromptRules,
  tag,
  tidyStudentPrompt,
} from './shared'

export function improveLanguage(input: ImproveInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(input.draft) ? 'fi' : 'en'
}

function system(input: ImproveInput, lang: string): string {
  const a = input.assistant || 'their AI assistant'
  return `The student typed a draft message into ${a}. Rewrite it into a prompt that makes them learn, not just get an answer — without changing what they want.
- Keep the intent and every specific detail of the draft (topic, numbers, constraints). Never answer the question yourself.
- Add one line of their context from <student> and <context> (only facts given there).
- If they are trying to understand a concept: ask for a short structured explanation and add an active-learning hook.
- If they clearly want a quick fact, a translation or a task done: keep it short and only add context and the format they need (no quiz hook).
- If they ask the AI to do graded work for them (write my essay, solve my homework), turn it into a request for guidance and hints.

${studentPromptRules(a, lang)}

Also return coachTip: "What I improved: …" — one sentence, ≤ 20 words, naming the most useful change.`
}

function user(input: ImproveInput): string {
  return [
    tag('student', input.profile || '(no profile)'),
    tag('context', input.context.trim() ? clip(input.context, 1500) : '(none)'),
    tag('draft', input.draft),
  ].join('\n')
}

export const improvePrompt: PromptSpec<ImproveInput, PromptWithTip, PromptWithTip> = {
  id: 'P8',
  task: 'improvePrompt',
  version: 1,
  tier: 'write',
  temperature: 0.5,
  maxOutputTokens: 900,
  reasoningEffort: 'low',
  schemaName: 'improved_prompt',
  schema: PromptWithTipSchema,
  onDeviceOk: false,
  cacheable: true,
  language: improveLanguage,
  build: (input) => ({ system: system(input, improveLanguage(input)), user: user(input) }),
  check: (out) => checkStudentPrompt(out.prompt).filter((i) => !i.includes('brevity rule')),
  finalize(out, input) {
    let tip = limitWords(out.coachTip, 25)
    if (!/^what i improved/i.test(tip) && improveLanguage(input) === 'en')
      tip = `What I improved: ${tip}`
    return { prompt: tidyStudentPrompt(out.prompt, improveLanguage(input)), coachTip: tip }
  },
}
