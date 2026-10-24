/**
 * P7 Gap fixer (tier `write`): diagnoses the misconception behind each missed question and writes
 * one repair prompt for the student's AI that contrasts wrong and right ideas, asks for an
 * example each and ends with a two-question self-check; also suggests the next topic.
 */
import { type GapInput, type GapOutput, GapOutput as GapOutputSchema } from '@engine/brain-contract'
import { looksFinnish } from '../llm/text'
import {
  checkStudentPrompt,
  limitWords,
  type PromptSpec,
  quizMeLine,
  studentPromptRules,
  tag,
  tidyStudentPrompt,
} from './shared'

export function gapLanguage(input: GapInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(input.misses.map((m) => `${m.stem} ${m.correct}`).join('\n')) ? 'fi' : 'en'
}

function system(input: GapInput, lang: string): string {
  const a = input.assistant || 'their AI assistant'
  return `A student missed the quiz questions below. Help them repair the underlying misconceptions.
1. diagnoses: for each missed question, the concept and the misconception behind the wrong choice, in ≤ 12 words ("thinks primary carbocations are the most stable"). Merge duplicates.
2. prompt: ONE message for the student to paste into ${a} that repairs all of them: for each misconception, contrast the wrong idea with the right one in first person ("I thought X, but the answer was Y — explain why"), ask for one concrete example each, and end with exactly: "${quizMeLine(lang)}"
3. nextTopic: one short topic name that builds on what they will now know.

${studentPromptRules(a, lang)}`
}

function user(input: GapInput): string {
  const misses = input.misses.map(
    (m, i) =>
      `${i + 1}. [${m.concept}] ${m.stem}\n   chosen: ${m.chosen}\n   correct: ${m.correct}\n   why: ${m.rationale}`,
  )
  return [tag('student', input.profile || '(no profile)'), tag('misses', misses.join('\n'))].join(
    '\n',
  )
}

export const gapsPrompt: PromptSpec<GapInput, GapOutput, GapOutput> = {
  id: 'P7',
  task: 'fixGaps',
  version: 1,
  tier: 'write',
  temperature: 0.4,
  maxOutputTokens: 1200,
  reasoningEffort: 'low',
  schemaName: 'gap_fix',
  schema: GapOutputSchema,
  onDeviceOk: false,
  cacheable: true,
  language: gapLanguage,
  build: (input) => ({ system: system(input, gapLanguage(input)), user: user(input) }),
  check: (out) =>
    checkStudentPrompt(out.prompt, { maxWords: 120 }).filter((i) => !i.includes('brevity rule')),
  finalize(out, input) {
    const lang = gapLanguage(input)
    let prompt = tidyStudentPrompt(out.prompt, lang)
    const closing = quizMeLine(lang)
    if (!prompt.includes(closing)) prompt = `${prompt}\n${closing}`
    return {
      diagnoses: out.diagnoses
        .filter((d) => d.concept.trim() && d.misconception.trim())
        .map((d) => ({
          concept: d.concept.trim(),
          misconception: limitWords(d.misconception, 14),
        })),
      prompt,
      nextTopic: out.nextTopic.trim(),
    }
  },
}
