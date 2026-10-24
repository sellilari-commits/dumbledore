/**
 * P11 Nudge writer (tier `triage`): a toast title + one ≤ 14-word line with a single call to
 * action — specific, friendly, never guilt-tripping.
 */
import {
  type NudgeInput,
  type NudgeOutput,
  NudgeOutput as NudgeOutputSchema,
} from '@engine/brain-contract'
import { countWords, looksFinnish } from '../llm/text'
import { languageName, limitWords, type PromptSpec, tag } from './shared'

export function nudgeLanguage(input: NudgeInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(input.facts) ? 'fi' : 'en'
}

export const nudgePrompt: PromptSpec<NudgeInput, NudgeOutput, NudgeOutput> = {
  id: 'P11',
  task: 'writeNudge',
  version: 1,
  tier: 'triage',
  temperature: 0.6,
  maxOutputTokens: 300,
  reasoningEffort: 'low',
  schemaName: 'nudge',
  schema: NudgeOutputSchema,
  onDeviceOk: true,
  cacheable: true,
  language: nudgeLanguage,
  build: (input) => ({
    system: `You write one short nudge from a study coach, shown as a small toast on the student's screen.
- title: 2–5 words.
- body: at most 14 words, specific (use the facts), one clear call to action, friendly, no guilt, no exclamation marks, no emoji.
- Example — facts: "carbocation stability: missed 2 of 3 yesterday; 3-minute review available" → title "Carbocations, quick check", body "3-minute check on carbocations? You missed two yesterday."
Write in ${languageName(nudgeLanguage(input))}.`,
    user: [tag('kind', input.kind), tag('facts', input.facts)].join('\n'),
  }),
  check: (out) =>
    countWords(out.body) > 16 ? [`body has ${countWords(out.body)} words; max 14`] : [],
  finalize: (out) => ({
    title: limitWords(out.title.replace(/[!]+/g, '').trim(), 6),
    body: limitWords(out.body.trim(), 16),
  }),
}
