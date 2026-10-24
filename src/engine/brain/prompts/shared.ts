/**
 * Building blocks shared by the prompt modules: the PromptSpec shape every agent implements,
 * tagged input sections, the student-prompt rules (docs/PLAN.md §7) in English and Finnish, and
 * a checker for those rules (used for soft-repair and by the eval harness).
 */
import type { LlmTier } from '@shared/llm'
import type { ZodType } from 'zod'
import { countWords } from '../llm/text'
import type { ReasoningEffort } from '../llm/types'

export interface BuildContext {
  /** True when the request goes to Apple's on-device model (small context: use compact text). */
  onDevice: boolean
  /** Local date for resolving "due Friday", e.g. "2026-10-24 (Saturday)". */
  today: string
}

export interface BuiltPrompt {
  system: string
  user: string
}

/** One LLM agent: typed input → prompt strings, zod output schema, routing knobs, post-processing. */
export interface PromptSpec<I, L, O> {
  id: string
  task: string
  /** Bump when the prompt text changes (invalidates the response cache). */
  version: number
  tier: LlmTier
  temperature: number
  maxOutputTokens: number
  /** Output cap on Apple's on-device model (4K context, one item per call); default maxOutputTokens. */
  onDeviceMaxOutputTokens?: number
  reasoningEffort: ReasoningEffort | null
  schemaName: string
  schema: ZodType<L>
  /** May this task run on Apple's on-device model at all? */
  onDeviceOk: boolean
  cacheable: boolean
  /** Content language of this request ("en", "fi", …) for routing. */
  language(input: I): string
  build(input: I, ctx: BuildContext): BuiltPrompt
  /** Soft rule violations of a schema-valid answer; non-empty → one repair if time allows. */
  check?(out: L, input: I): string[]
  finalize(out: L, input: I): O
}

export function tag(
  name: string,
  content: string,
  attrs: Record<string, string | number | null> = {},
): string {
  const a = Object.entries(attrs)
    .filter(([, v]) => v !== null && v !== '')
    .map(([k, v]) => ` ${k}="${String(v).replace(/"/g, "'")}"`)
    .join('')
  return `<${name}${a}>\n${content.trim()}\n</${name}>`
}

/** At most this many feedback lines reach one prompt. */
export const FEEDBACK_LINES = 5

/**
 * Adds the student's recent feedback (chat, give_feedback) to a prompt's user message. The cache
 * key is built from the final text, so new feedback never reuses an older answer.
 */
export function withFeedback<I, L, O>(
  spec: PromptSpec<I, L, O>,
  lines: readonly string[],
): PromptSpec<I, L, O> {
  const kept = lines.map((l) => l.trim()).filter(Boolean).slice(0, FEEDBACK_LINES)
  if (kept.length === 0) return spec
  const block = tag(
    'student_feedback',
    `What the student told you about this kind of work (newest first); follow it where it fits:\n${kept.map((l) => `- ${l}`).join('\n')}`,
  )
  return {
    ...spec,
    build(input, ctx) {
      const built = spec.build(input, ctx)
      return { ...built, user: `${built.user}\n${block}` }
    },
  }
}

export function languageName(code: string): string {
  const c = code.toLowerCase().slice(0, 2)
  return (
    { en: 'English', fi: 'Finnish', sv: 'Swedish', de: 'German', fr: 'French', es: 'Spanish' }[c] ??
    'the language of the student'
  )
}

const BREVITY: Record<string, string> = {
  en: 'No greetings or small talk. Short structured bullets, max ~150 words, bold key terms.',
  fi: 'Ei tervehdyksiä eikä small talkia. Lyhyet jäsennellyt luettelokohdat, enintään ~150 sanaa, avaintermit lihavoituna.',
}
const HOOK: Record<string, string> = {
  en: 'Then ask me one question to check I got it, and wait.',
  fi: 'Kysy sitten minulta yksi kysymys, jolla tarkistat että ymmärsin, ja odota vastaustani.',
}
const QUIZ_ME: Record<string, string> = {
  en: 'Then quiz me with 2 new questions and wait for my answers.',
  fi: 'Kysy sitten minulta 2 uutta kysymystä ja odota vastauksiani.',
}

const pick = (table: Record<string, string>, lang: string) =>
  table[lang.slice(0, 2)] ?? (table.en as string)
export const brevityRule = (lang: string) => pick(BREVITY, lang)
export const activeHook = (lang: string) => pick(HOOK, lang)
export const quizMeLine = (lang: string) => pick(QUIZ_ME, lang)

export const STUDENT_PROMPT_MAX_WORDS = 110

/** A worked example of the shape (on an unrelated topic, so models copy the form, not the words). */
const EXAMPLE: Record<string, string> = {
  en: "I'm a first-year biology student; I know what a cell membrane is, but osmosis confuses me.\nExplain osmosis:\n1. What moves, and in which direction\n2. Why it happens\n3. One everyday example",
  fi: 'Olen lukion ensimmäisen vuoden opiskelija; tiedän mikä solukalvo on, mutta osmoosi on minulle epäselvä.\nSelitä osmoosi:\n1. Mikä liikkuu ja mihin suuntaan\n2. Miksi niin tapahtuu\n3. Yksi arkinen esimerkki',
}

/** The student-prompt rules (§7), stated for a model that writes prompts for {assistant}. */
export function studentPromptRules(assistant: string, lang: string): string {
  return [
    `Student-prompt rules (the student pastes the text into ${assistant} and sends it as their own message):`,
    '- Written as the student, in first person ("I…", "my…"). Never mention Dumbledore, a coach, an app or these rules.',
    "- Line 1: one first-person sentence of the student's context — level/course, what they already know, what confuses them. Rephrase the profile into first person; use only facts you were given.",
    '- Then ask for exactly what this step needs as a short numbered list (2–4 items), each item on its own line.',
    `- Include this brevity rule verbatim: "${brevityRule(lang)}"`,
    `- When the student is learning a concept, end with an active-learning hook such as: "${activeHook(lang)}"`,
    `- Write in ${languageName(lang)}. Plain text with line breaks; no markdown headings; no greeting, thanks or sign-off.`,
    `- At most ${STUDENT_PROMPT_MAX_WORDS} words in total (brevity rule included).`,
    `Example of the shape (different topic):\n${pick(EXAMPLE, lang)}\n${brevityRule(lang)}\n${activeHook(lang)}`,
  ].join('\n')
}

const GREETING =
  /^\s*(hi|hello|hey|dear|good (morning|afternoon|evening)|greetings|hei|moi|moikka|terve|hej|hallo)\b/i
const LEADING_GREETING =
  /^\s*(hi|hello|hey|greetings|hei|moi|moikka|terve|hej|hallo)(\s+(there|chatgpt|claude|gemini|perplexity|copilot|all|everyone))?\s*[!,.:;]+\s*/i
const BREVITY_MARKERS = [
  /no greetings/i,
  /small talk/i,
  /tervehdyks/i,
  /max(imum)? ~?\d+ words/i,
  /enintään ~?\d+ sanaa/i,
]
const FIRST_PERSON =
  /\b(i|i'm|im|i've|i'd|my|me|minä|mä|olen|en|minun|minulle|minua|minulla|osaan|tiedän|ymmärrän|opiskelen|haluan|luen|tarvitsen|valmistaudun)\b/i

/** First line / sentence of a prompt (where the context line belongs). */
function opening(text: string): string {
  const firstLine = text.trim().split('\n')[0] ?? ''
  return firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
}

/** Rule violations of a prompt written for the student's AI (empty = passes). */
export function checkStudentPrompt(text: string, opts: { maxWords?: number } = {}): string[] {
  const issues: string[] = []
  const words = countWords(text)
  const max = opts.maxWords ?? STUDENT_PROMPT_MAX_WORDS
  if (words > max) issues.push(`prompt has ${words} words; the limit is ${max}`)
  if (words < 12) issues.push('prompt is too short to be useful')
  if (GREETING.test(text)) issues.push('prompt starts with a greeting; remove it')
  if (/dumbledore/i.test(text)) issues.push('prompt mentions Dumbledore; remove it')
  if (!BREVITY_MARKERS.some((re) => re.test(text))) {
    issues.push('prompt lacks the brevity rule sentence')
  }
  if (!FIRST_PERSON.test(opening(text))) {
    issues.push('the first line must be the student\'s context in first person ("I\'m …")')
  }
  if (/^#{1,6}\s/m.test(text)) issues.push('prompt uses markdown headings; use plain lines')
  return issues
}

/** Deterministic clean-up for student prompts: drop greetings/Dumbledore, add a missing brevity rule. */
export function tidyStudentPrompt(text: string, lang: string): string {
  let t = text.replace(/\r\n/g, '\n').trim()
  t = t.replace(/^#{1,6}\s+/gm, '')
  for (let i = 0; i < 2 && LEADING_GREETING.test(t); i++) t = t.replace(LEADING_GREETING, '')
  const lines = t.split('\n')
  if (lines[0] && GREETING.test(lines[0]) && countWords(lines[0]) <= 4) lines.shift()
  t = lines
    .join('\n')
    .replace(/\s*\(?\b[Dd]umbledore\b\)?[,:]?[ \t]*/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
  // "I need: 1. … 2. … 3. …" on one line → one item per line.
  t = t
    .split('\n')
    .map((line) =>
      (line.match(/(^|\s)\d\.\s/g) ?? []).length >= 2 ? line.replace(/\s+(?=\d\.\s)/g, '\n') : line,
    )
    .join('\n')
    // The brevity rule and the quiz hook read best on their own lines.
    .replace(
      /[ \t]+(?=(No greetings or small talk|Ei tervehdyksiä|Then ask me one question|Then quiz me|Kysy sitten minulta)\b)/g,
      '\n',
    )
  if (t) t = t[0]?.toUpperCase() + t.slice(1)
  if (!BREVITY_MARKERS.some((re) => re.test(t))) t = `${t}\n${brevityRule(lang)}`
  return t
}

/** Words of `limit`, cut at a sentence end when possible (for short UI strings like coach tips). */
export function limitWords(text: string, limit: number): string {
  const words = text.trim().split(/\s+/)
  if (words.length <= limit) return text.trim()
  const cut = words.slice(0, limit).join(' ')
  const end = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('! '), cut.lastIndexOf('? '))
  return end > cut.length / 2 ? cut.slice(0, end + 1) : `${cut.replace(/[,;:]$/, '')}…`
}

export function bullets(items: string[], empty = '(none)'): string {
  return items.length ? items.map((s) => `- ${s}`).join('\n') : empty
}
