/**
 * P9 Suggester (tier `write`): picks the single best prompt for an empty chat box from ranked
 * candidates (session step › locked topic › open question › struggling concept › due review › deadline ›
 * starter) and writes it following the student-prompt rules.
 */
import {
  type SuggestInput,
  type SuggestOutput,
  SuggestOutput as SuggestOutputSchema,
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

export function suggestLanguage(input: SuggestInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(input.candidates.map((c) => c.text).join('\n')) ? 'fi' : 'en'
}

function system(input: SuggestInput, lang: string): string {
  const a = input.assistant || 'their AI assistant'
  return `The student has an empty chat box open in ${a}. Pick the single most useful thing for them to ask right now from <candidates> (ranked best first; take the first one unless <context> makes another clearly more relevant) and write it as a ready-to-send prompt.

${studentPromptRules(a, lang)}

Return basedOn = the kind of the candidate you used, and coachTip: one sentence (≤ 20 words) on why this prompt works.`
}

function user(input: SuggestInput): string {
  return [
    tag('student', input.profile || '(no profile)'),
    tag('context', input.context.trim() ? clip(input.context, 1500) : '(none)'),
    tag('candidates', input.candidates.map((c, i) => `${i + 1}. [${c.kind}] ${c.text}`).join('\n')),
  ].join('\n')
}

export const suggestPrompt: PromptSpec<SuggestInput, SuggestOutput, SuggestOutput> = {
  id: 'P9',
  task: 'suggestPrompt',
  version: 1,
  tier: 'write',
  temperature: 0.5,
  maxOutputTokens: 900,
  reasoningEffort: 'low',
  schemaName: 'suggestion',
  schema: SuggestOutputSchema,
  onDeviceOk: false,
  cacheable: true,
  language: suggestLanguage,
  build: (input) => ({ system: system(input, suggestLanguage(input)), user: user(input) }),
  check: (out) => checkStudentPrompt(out.prompt).filter((i) => !i.includes('brevity rule')),
  finalize: (out, input) => ({
    prompt: tidyStudentPrompt(out.prompt, suggestLanguage(input)),
    coachTip: limitWords(out.coachTip, 25),
    basedOn: input.candidates.some((c) => c.kind === out.basedOn)
      ? out.basedOn
      : (input.candidates[0]?.kind ?? out.basedOn),
  }),
}
