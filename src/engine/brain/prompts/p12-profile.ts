/**
 * P12 Profiler (tier `reason`, daily): a ≤ 200-word learner profile — level, goals and deadlines,
 * strengths, recurring struggles, how they use AI — and the two prompting habits most worth
 * coaching next.
 */
import {
  type ProfileInput,
  type ProfileOutput,
  ProfileOutput as ProfileOutputSchema,
} from '@engine/brain-contract'
import { clip, countWords } from '../llm/text'
import { limitWords, type PromptSpec, tag } from './shared'

export const profilePrompt: PromptSpec<ProfileInput, ProfileOutput, ProfileOutput> = {
  id: 'P12',
  task: 'buildProfile',
  version: 1,
  tier: 'reason',
  temperature: 0.3,
  maxOutputTokens: 1500,
  reasoningEffort: 'low',
  schemaName: 'learner_profile',
  schema: ProfileOutputSchema,
  onDeviceOk: false,
  cacheable: true,
  language: () => 'en',
  build: (input) => ({
    system: `You maintain a learner profile for a study coach. From the inputs, write:
- summary: ≤ 200 words, third person, plain sentences: level and program, goals and deadlines, strengths, recurring struggles, and how they use AI chats (do they give context? ask to be quizzed? ask for examples?). Only facts supported by the inputs; say "unknown" rather than guess.
- level: a short label such as "1st-year university (chemistry)", or null if unknown.
- habitsToCoach: exactly 2 prompting habits most worth coaching next, each an imperative ≤ 12 words ("Say what you already know before asking").`,
    user: [
      tag('about_me', input.aboutMe || '(empty)'),
      tag('subjects', clip(input.subjects, 3000) || '(none)'),
      tag('struggles', clip(input.struggles, 2000) || '(none)'),
      tag('prompt_habits', clip(input.habits, 1500) || '(none)'),
    ].join('\n'),
  }),
  check: (out) =>
    countWords(out.summary) > 220 ? [`summary has ${countWords(out.summary)} words; max 200`] : [],
  finalize: (out) => ({
    summary: out.summary.trim(),
    level: out.level?.trim() || null,
    habitsToCoach: out.habitsToCoach
      .map((h) => limitWords(h, 14))
      .filter(Boolean)
      .slice(0, 2),
  }),
}
