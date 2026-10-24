/**
 * P14 Study preferences (tier `triage`): maps what the student said about a subject's roadmap in
 * the double-tap chat ("on chemistry I want SN1, not SN2") onto the subject's concept tree.
 * Concepts travel as short refs (c1…); finalize maps them back. Nothing is trusted here:
 * learning/study/preferences.ts drops unknown ids and merges the answer with earlier wishes.
 */
import type { PreferencesInput, PreferencesOutput } from '@engine/brain-contract'
import { z } from 'zod'
import { looksFinnish } from '../llm/text'
import { type PromptSpec, tag } from './shared'

export const LlmPreferences = z.object({
  replace: z.boolean(),
  focus: z.array(z.string()),
  skip: z.array(z.string()),
  focusNames: z.array(z.string()),
  skipNames: z.array(z.string()),
})
export type LlmPreferences = z.infer<typeof LlmPreferences>

const SYSTEM = `A student tells their study coach what one subject's roadmap should and should not cover. You get the subject's concept tree ("c3 Name < c1": c3 sits under c1; "< -" = top level), the wishes already stored (as refs), and the student's new words.

Return:
- focus: refs of the concepts the student wants (to learn, go deeper on, or start with). Naming a topic means the topic ref; its sub-concepts follow it automatically.
- skip: refs of the concepts the student does not want ("not", "skip", "already know", "without").
- focusNames / skipNames: wishes that match no listed concept, as short concept names (1–4 words) in the student's language; [] when everything matched.
- replace: true only when the new words clearly start over ("forget that", "instead, only …"); then focus and skip replace the stored wishes. Otherwise false: the new wishes are added to the stored ones.

Map by meaning, not just spelling (synonyms, abbreviations, other languages). Never put the same concept in focus and skip. Use only refs from the input. Return JSON only.`

/** Short concept refs both ways (c1… in listing order). */
export function preferenceRefs(input: PreferencesInput): {
  toId: Map<string, string>
  ref: Map<string, string>
} {
  const toId = new Map<string, string>()
  const ref = new Map<string, string>()
  input.concepts.forEach((c, i) => {
    ref.set(c.id, `c${i + 1}`)
    toId.set(`c${i + 1}`, c.id)
  })
  return { toId, ref }
}

export function buildPreferencesUser(input: PreferencesInput): string {
  const { ref } = preferenceRefs(input)
  const r = (id: string | null) => (id ? (ref.get(id) ?? '-') : '-')
  const concepts = input.concepts.map((c) => `${r(c.id)} ${c.name} < ${r(c.parentId)}`)
  const refs = (ids: string[]) =>
    ids.flatMap((id) => (ref.has(id) ? [r(id)] : [])).join(', ') || '(none)'
  return [
    tag(
      'subject',
      `${input.subject.name}${input.subject.goal ? ` · goal: ${input.subject.goal}` : ''}`,
    ),
    tag('concepts', concepts.join('\n') || '(none)'),
    tag('stored', `focus: ${refs(input.current.focus)}\nskip: ${refs(input.current.skip)}`),
    tag('student_says', input.instruction),
  ].join('\n')
}

export function finalizePreferences(
  out: LlmPreferences,
  input: PreferencesInput,
): PreferencesOutput {
  const { toId } = preferenceRefs(input)
  // Unknown refs pass through unchanged; preferences.ts drops what does not exist.
  const ids = (refs: string[]) => refs.map((x) => toId.get(x.trim()) ?? x.trim()).filter(Boolean)
  const names = (xs: string[]) => xs.map((x) => x.trim()).filter(Boolean)
  return {
    replace: out.replace,
    focus: ids(out.focus),
    skip: ids(out.skip),
    focusNames: names(out.focusNames),
    skipNames: names(out.skipNames),
  }
}

export const preferencesPrompt: PromptSpec<PreferencesInput, LlmPreferences, PreferencesOutput> = {
  id: 'P14',
  task: 'preferences',
  version: 1,
  tier: 'triage',
  temperature: 0,
  maxOutputTokens: 600,
  reasoningEffort: null,
  schemaName: 'study_preferences',
  schema: LlmPreferences,
  onDeviceOk: true,
  cacheable: false,
  language: (input) =>
    input.language && input.language !== 'auto'
      ? input.language.slice(0, 2)
      : looksFinnish(input.instruction)
        ? 'fi'
        : 'en',
  build: (input) => ({ system: SYSTEM, user: buildPreferencesUser(input) }),
  finalize: finalizePreferences,
}
