/**
 * P1 Extractor (tier `extract`): screen-text episodes → "is the student learning?" plus the three
 * parts (seen / big picture / understanding), open questions, assignments, and — for AI chats —
 * the student's own prompts scored for coaching, and 1–5 atomic notes per item that the model
 * places on the subject's concept tree itself (A-MEM style; docs/NOTES.md §4). Concepts are shown
 * with short refs (c1, c2 …) to keep tokens down; finalize maps them back to ids. Full variant
 * with two few-shot examples for cloud models; compact variant for Apple's 4K on-device context.
 */
import type { ExtractInput, ExtractOutput } from '@engine/brain-contract'
import { UnderstandingStatus } from '@shared/domain'
import { z } from 'zod'
import { looksFinnish } from '../llm/text'
import { type PromptSpec, tag } from './shared'

const LlmItem = z.object({
  topicPath: z.array(z.string()),
  seen: z.string().min(1),
  bigPicture: z.string().min(1),
  evidence: z.string(),
  understanding: UnderstandingStatus,
  openQuestions: z.array(z.string()),
  keyTerms: z.array(z.string()),
  subjectMatchId: z.string().nullable(),
  subjectNewName: z.string().nullable(),
  assignment: z
    .object({ title: z.string(), course: z.string().nullable(), dueAt: z.string().nullable() })
    .nullable(),
  notes: z
    .array(
      z.object({
        text: z.string(),
        keywords: z.array(z.string()),
        conceptId: z.string().nullable(),
        newConcept: z.object({ name: z.string(), parentId: z.string().nullable() }).nullable(),
      }),
    )
    .default([]),
})
const LlmPrompt = z.object({
  text: z.string(),
  hasContext: z.boolean(),
  hasStructure: z.boolean(),
  asksToBeQuizzed: z.boolean(),
  asksForExamples: z.boolean(),
})
export const LlmExtract = z.object({
  results: z.array(
    z.object({
      episodeId: z.string(),
      reason: z.string(),
      isLearning: z.boolean(),
      confidence: z.number(),
      items: z.array(LlmItem),
      studentPrompts: z.array(LlmPrompt),
    }),
  ),
})
export type LlmExtract = z.infer<typeof LlmExtract>

export const LEARNING = `LEARNABLE CONTENT (isLearning=true): facts, explanations, definitions, worked examples, formulas, arguments or ideas that a student could know, understand or be tested on afterwards. For example textbook or course material, lecture slides or notes, papers, encyclopedia and history pages, news and articles with real facts, documentation or tutorials, an AI explaining something, practice problems, flashcards, educational videos (captions/slides), assignments, exam or deadline information.
NOTHING TO LEARN FROM (isLearning=false): social media feeds, shopping, entertainment, messaging small talk, email triage, settings and sign-in screens, search result lists, just navigating, routine work where nothing new is being learned, UI noise (menus, buttons, ads, cookie banners).`

/** On-device (4K context) keeps the short form; the cloud prompt spells out the real traps. */
const RULES_COMPACT = `${LEARNING} Coding-agent work on one's own project and Dumbledore's own screens (its sidebar, subject pages, "Step 3 of 8") are not learning. Judge the content, not the intent: real learnable content on screen means isLearning=true; little or nothing to learn from means false. Never invent anything the text does not support.`

const RULES = `${LEARNING.slice(0, -1)} Also nothing to learn from:
- an AI chat's empty start page (greeting, sign-in, terms and cookie text, no question or answer);
- building or fixing one's own software with a coding agent or AI assistant (edits, builds, signing, permissions, installs, commits, test runs, "Ran a command", task lists) — that is work, even when the AI explains steps, unless the student explicitly asks to understand a concept;
- the screens of Dumbledore, this study coach, shown in any window (a sidebar "Dumbledore · Search ⌘K · Inbox · Exams · Settings · Subjects", subject pages with goals and progress, "Step 3 of 8", "reviews due", "Struggling with", "Prompting habits", deadlines it lists): these are the coach's own records or demo data, never new evidence, never an assignment.
Judge an episode by what the student reads, asks or writes, not by subject names that appear in menus or sidebars. Judge the content, not the intent: if the episode has real learnable content the student read, watched or discussed, isLearning=true even when you can't tell whether they meant to study; if there is little or nothing to learn from, isLearning=false. Never invent anything the text does not support.`

const ITEM_RULES = `For each learning episode give one item per distinct topic (usually 1, at most 3):
- topicPath: broad → specific, 2–4 levels, e.g. ["Organic Chemistry","Nucleophilic substitution","SN1"].
- seen: the actual content on screen — the specific claim, definition, formula or example as shown, paraphrased in ≤ 60 words, keeping key terms and symbols. For AI chats: what the AI explained, or what the student asked if there is no answer yet. Describe the content, never the interface ("the chat displays…", "the page shows…").
- bigPicture: one sentence: what the student is trying to learn or be able to do, and why (course, exam, assignment, curiosity).
- evidence, then understanding: quote concrete signals or chat text as evidence, then choose
  understood = positive evidence (correct answer, correct explain-back);
  unclear = some sign of difficulty (one rephrased question, "simpler please", slowish reading);
  struggling = strong or repeated signs (scrolled back 3+ times, much slower than usual, the same question asked again, "I don't get it", wrong answers);
  unknown = no evidence either way (the default; never guess struggling).
- openQuestions: up to 3 questions the student probably still has, phrased as they would ask; [] when nothing suggests one.
- keyTerms: 3–8 terms from the text.
- subjectMatchId: id of the listed subject this belongs to, else null. subjectNewName: when no listed subject fits, a short, broad subject name for this content (course-like, e.g. "Linear Algebra", "Finnish History"); it is created right away, so reuse a listed subject whenever one fits. null only when no sensible subject exists. Never fill both.
- assignment: only when the text names an assignment, exam or deadline: {title, course or null, dueAt as YYYY-MM-DD or null}; resolve relative dates ("Friday") from <today>. Otherwise null.`

const NOTE_RULES = `- notes: 1–5 facts worth remembering from this item: a definition, fact, formula, date or example, each ≤ 25 words and self-contained ("X is Y"), in the language of the page, about the content only (never the site, menus or interface; leave out page controls glued to the text, e.g. a Wikipedia "edit" link: "Economics and political scienceedit" → "Economics and political science", and "[edit]", "[1]"), no two saying the same thing. For each note: keywords (1–5 short terms, for linking notes later) and its place in the subject's concept tree, listed under <subjects> as "c3 Name < c1" (c1 is its parent): conceptId = the ref of the existing concept it belongs to (prefer this: a topic gathers every page about the same thing, so content about an existing topic goes there even when it comes from another site or uses other words), or, when none fits, conceptId null and newConcept {name: a specific topic of 2–5 words, never a sentence; parentId: the ref of its parent concept, or null for a new top-level topic}. With no matching subject, use newConcept with parentId null.`

/** On-device (4K context): the same notes, said briefly. */
const NOTE_RULES_COMPACT = `- notes: 1–5 short facts (≤ 25 words, page language, content only), each with 1–3 keywords and conceptId = the ref of the listed concept it belongs to (same thing from another page = same concept), else newConcept {name, parentId ref or null}.`

const CONTEXT_RULES = `Context: <context> lists what else the student had open in the same few minutes. Use it to judge each episode and to name its topic (a page next to a chat on the same topic is study), but record only the episode's own content. Record the content itself, never site chrome: navigation, sidebars, related links, ads, footers.`

const HIGHLIGHT_RULES = `Highlights: <highlighted> lists text the student selected on screen to mark it as important — a note they chose to keep. An episode with highlights is always learning (isLearning=true): put each highlighted passage in \`seen\` (quote it, or paraphrase it closely) and its key words in keyTerms, even when the rest of the page is noise.`

const CHAT_RULES = `AI-chat episodes (kind="ai_chat"): lines tagged [R] are usually the student's messages, [L] the AI's. A repeated or rephrased question is evidence of confusion. Put every student message in studentPrompts: text, hasContext (states their level, course, what they know or what confuses them), hasStructure (asks for a format, steps, length or numbered points), asksToBeQuizzed, asksForExamples. For other episodes studentPrompts is [].`

const OUTPUT_RULES = `Return one result per episode, in input order, with its episodeId. reason: ≤ 15 words. confidence: how sure you are about isLearning (0–1). Non-learning episodes: items [] and studentPrompts [].`

const EXAMPLES = `Example input:
<episode id="x1" kind="reading" app="Safari" title="Photosynthesis – Khan Academy" dwell="4m10s">
<signals>reading=slow (90 wpm vs 200 usual) · scrolled_back=4</signals>
<text>
[L] The light-dependent reactions take place in the thylakoid membranes.
[L] The ATP and NADPH they make power the Calvin cycle in the stroma.
</text>
</episode>
<episode id="x2" kind="other" app="Instagram" title="Instagram" dwell="2m0s">
<signals>(none)</signals>
<text>[C] Liked by anna_k and 212 others · Suggested for you · Follow</text>
</episode>
Example output:
{"results":[{"episodeId":"x1","reason":"Studying photosynthesis on Khan Academy","isLearning":true,"confidence":0.95,"items":[{"topicPath":["Biology","Photosynthesis","Light-dependent reactions"],"seen":"Light-dependent reactions happen in the thylakoid membranes; the ATP and NADPH they make power the Calvin cycle in the stroma.","bigPicture":"Understanding how the two stages of photosynthesis connect, likely for a biology course.","evidence":"Read at 90 wpm vs 200 usual and scrolled back 4 times.","understanding":"struggling","openQuestions":["How do ATP and NADPH actually drive the Calvin cycle?"],"keyTerms":["thylakoid","ATP","NADPH","Calvin cycle","stroma"],"subjectMatchId":null,"subjectNewName":"Biology","assignment":null,"notes":[{"text":"The light-dependent reactions take place in the thylakoid membranes.","keywords":["light-dependent reactions","thylakoid"],"conceptId":null,"newConcept":{"name":"Light-dependent reactions","parentId":null}},{"text":"ATP and NADPH from the light-dependent reactions power the Calvin cycle in the stroma.","keywords":["ATP","NADPH","Calvin cycle"],"conceptId":null,"newConcept":{"name":"Calvin cycle","parentId":null}}]}],"studentPrompts":[]},{"episodeId":"x2","reason":"Social media feed","isLearning":false,"confidence":0.97,"items":[],"studentPrompts":[]}]}

Example input:
<subjects>- id=sub_m · Calculus
  c1 Limits
  c2 Derivatives < c1</subjects>
<episode id="x3" kind="ai_chat" app="Google Chrome" title="ChatGPT" dwell="3m5s">
<signals>ai_questions=["what is a derivative","explain it simpler pls"]</signals>
<text>
[R] what is a derivative
[L] A derivative measures how fast a function changes at a point: the slope of its tangent line.
[R] explain it simpler pls
[L] Think of speed: if f(t) is your position, f'(t) is how fast you are going right now.
</text>
</episode>
Example output:
{"results":[{"episodeId":"x3","reason":"Asking ChatGPT what a derivative is","isLearning":true,"confidence":0.95,"items":[{"topicPath":["Mathematics","Calculus","Derivatives"],"seen":"The AI explained a derivative as the instantaneous rate of change (slope of the tangent line), with position and speed as the analogy: f'(t) is the speed.","bigPicture":"Getting an intuitive grasp of what a derivative means, probably early in a calculus course.","evidence":"Asked 'explain it simpler pls' right after the first explanation.","understanding":"unclear","openQuestions":["How do I actually calculate a derivative?"],"keyTerms":["derivative","rate of change","tangent line","slope"],"subjectMatchId":"sub_m","subjectNewName":null,"assignment":null,"notes":[{"text":"A derivative is the slope of the tangent line: how fast a function changes at a point.","keywords":["derivative","tangent line","slope"],"conceptId":"c2","newConcept":null},{"text":"If f(t) is position, f'(t) is the speed at that moment.","keywords":["speed","position"],"conceptId":null,"newConcept":{"name":"Derivative as rate of change","parentId":"c2"}}]}],"studentPrompts":[{"text":"what is a derivative","hasContext":false,"hasStructure":false,"asksToBeQuizzed":false,"asksForExamples":false},{"text":"explain it simpler pls","hasContext":false,"hasStructure":false,"asksToBeQuizzed":false,"asksForExamples":false}]}]}`

const SYSTEM_FULL = `You are the perception module of a study coach running on a student's Mac. You receive text read from the student's screen during one or more episodes (a continuous stretch in one app or page) plus behaviour signals. For each episode, ask one question: does it contain learnable content? If yes, write down exactly what was there, precisely enough that a tutor could continue from that point.

${RULES}

${ITEM_RULES}
${NOTE_RULES}

${CONTEXT_RULES}

${HIGHLIGHT_RULES}

${CHAT_RULES}

${OUTPUT_RULES}

${EXAMPLES}`

const SYSTEM_COMPACT = `You are the perception module of a study coach. From screen text of one episode plus behaviour signals, ask: does it contain learnable content? If yes, write down exactly what was there.

${RULES_COMPACT}

${ITEM_RULES}
${NOTE_RULES_COMPACT}
Use <context> (other pages in the same minutes) only to judge and name the topic; record only the episode's own content, never site chrome.

Highlighted text is a note the student chose to keep: such an episode is always learning; quote it in seen and keyTerms.

${CHAT_RULES}

${OUTPUT_RULES}`

function formatDwell(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m${s % 60}s` : `${s}s`
}

export function formatSignals(sig: ExtractInput['episodes'][number]['signals']): string {
  const parts: string[] = []
  if (sig.readingWpm != null && sig.baselineWpm != null && sig.baselineWpm > 0) {
    const r = sig.readingWpm / sig.baselineWpm
    const pace = r < 0.6 ? 'slow' : r > 1.5 ? 'fast (skimming)' : 'normal'
    parts.push(
      `reading=${pace} (${Math.round(sig.readingWpm)} wpm vs ${Math.round(sig.baselineWpm)} usual)`,
    )
  } else if (sig.readingWpm != null) {
    parts.push(`reading=${Math.round(sig.readingWpm)} wpm`)
  }
  if (sig.scrollBacks > 0) parts.push(`scrolled_back=${sig.scrollBacks}`)
  if (sig.revisitsToday > 0) parts.push(`revisits_today=${sig.revisitsToday}`)
  if (sig.searches.length) parts.push(`searches=${JSON.stringify(sig.searches.slice(0, 5))}`)
  if (sig.aiQuestions.length)
    parts.push(`ai_questions=${JSON.stringify(sig.aiQuestions.slice(0, 5))}`)
  return parts.length ? parts.join(' · ') : '(none)'
}

/** Short refs for the listed concepts (c1, c2 … in listing order), both ways. */
export function conceptRefs(input: ExtractInput): {
  toId: Map<string, string>
  toRef: Map<string, string>
} {
  const toId = new Map<string, string>()
  const toRef = new Map<string, string>()
  for (const c of input.subjects.flatMap((s) => s.concepts ?? [])) {
    if (toRef.has(c.id)) continue
    const ref = `c${toRef.size + 1}`
    toRef.set(c.id, ref)
    toId.set(ref, c.id)
  }
  return { toId, toRef }
}

function subjectBlock(s: ExtractInput['subjects'][number], toRef: Map<string, string>): string {
  const head = `- id=${s.id} · ${s.name}`
  if (!s.concepts?.length)
    return s.topConcepts.length
      ? `${head} · concepts: ${s.topConcepts.slice(0, 8).join(', ')}`
      : head
  const lines = s.concepts.map((c) => {
    const parent = c.parentId ? toRef.get(c.parentId) : undefined
    return `  ${toRef.get(c.id)} ${c.name}${parent ? ` < ${parent}` : ''}`
  })
  return [head, ...lines].join('\n')
}

export function buildExtractUser(input: ExtractInput, today: string): string {
  const { toRef } = conceptRefs(input)
  const subjects = input.subjects.length
    ? input.subjects.map((s) => subjectBlock(s, toRef)).join('\n')
    : '(none yet)'
  const episodes = input.episodes.map((ep) =>
    tag(
      'episode',
      [
        tag('signals', formatSignals(ep.signals)),
        ...(ep.signals.highlights?.length
          ? [
              tag(
                'highlighted',
                `Student highlighted (marked as important):\n${ep.signals.highlights
                  .slice(0, 10)
                  .map((h) => `- ${h}`)
                  .join('\n')}`,
              ),
            ]
          : []),
        tag('text', ep.text || '(empty)'),
      ].join('\n'),
      {
        id: ep.id,
        kind: ep.kind,
        app: ep.app,
        ai: ep.aiProvider,
        url: ep.url,
        title: ep.title,
        dwell: formatDwell(ep.dwellSeconds),
      },
    ),
  )
  return [
    tag('today', today),
    tag(
      'student',
      `${input.student.aboutMe || '(no profile)'} · language: ${input.student.language}`,
    ),
    tag('subjects', subjects),
    ...(input.context?.length ? [tag('context', input.context.slice(0, 8).join(' · '))] : []),
    ...episodes,
  ].join('\n')
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}([T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/
const clean = (xs: string[], max: number) =>
  [...new Set(xs.map((x) => x.trim()).filter(Boolean))].slice(0, max)

/** Highlight snippet for `seen`: short enough to read, quoted. */
const quoteHighlight = (h: string) => `"${h.length > 300 ? `${h.slice(0, 297)}…` : h}"`

/**
 * A highlight is a strong signal of learning intent: an episode with highlights is always
 * learning, and every highlighted passage ends up in `seen` (and short ones in keyTerms), even
 * when the model said otherwise or left it out.
 */
export function keepHighlights(
  result: ExtractOutput['results'][number],
  ep: ExtractInput['episodes'][number],
): ExtractOutput['results'][number] {
  const highlights = ep.signals.highlights ?? []
  if (highlights.length === 0) return result
  const short = highlights.filter((h) => h.length <= 60)
  if (!result.isLearning || result.items.length === 0) {
    const where = ep.title ?? ep.app
    return {
      ...result,
      isLearning: true,
      confidence: Math.max(result.confidence, 0.9),
      reason: result.reason || 'Student highlighted text',
      items: [
        {
          subject: { matchId: null, newName: null },
          topicPath: [where],
          seen: `Highlighted: ${highlights.map(quoteHighlight).join(' · ')}`,
          bigPicture: `Marked as important while reading ${where}.`,
          understanding: { status: 'unknown', evidence: 'The student highlighted this text.' },
          openQuestions: [],
          keyTerms: clean(short, 10),
          assignment: null,
          notes: [],
        },
      ],
    }
  }
  const [first, ...rest] = result.items
  if (!first) return result
  const all = result.items.map((it) => it.seen.toLowerCase()).join(' ')
  const missing = highlights.filter((h) => !all.includes(h.slice(0, 40).toLowerCase()))
  const seen = missing.length
    ? `${first.seen} Highlighted: ${missing.map(quoteHighlight).join(' · ')}`
    : first.seen
  return {
    ...result,
    items: [{ ...first, seen, keyTerms: clean([...first.keyTerms, ...short], 10) }, ...rest],
  }
}

export function finalizeExtract(out: LlmExtract, input: ExtractInput): ExtractOutput {
  const subjectIds = new Set(input.subjects.map((s) => s.id))
  const { toId } = conceptRefs(input)
  return {
    results: input.episodes.map((ep, i) =>
      keepHighlights(finalizeOne(out, ep, i, subjectIds, toId), ep),
    ),
  }
}

/** A concept ref ("c3") back to its id; anything else passes through for apply.ts to check. */
const refToId = (ref: string | null | undefined, toId: Map<string, string>): string | null => {
  const t = ref?.trim()
  return t ? (toId.get(t) ?? t) : null
}

function finalizeNotes(
  notes: LlmExtract['results'][number]['items'][number]['notes'] | undefined,
  toId: Map<string, string>,
): NonNullable<ExtractOutput['results'][number]['items'][number]['notes']> {
  return (notes ?? [])
    .filter((n) => n.text.trim())
    .slice(0, 5)
    .map((n) => {
      const name = n.newConcept?.name.trim()
      return {
        text: n.text.trim(),
        keywords: clean(n.keywords, 5),
        conceptId: refToId(n.conceptId, toId),
        newConcept: name ? { name, parentId: refToId(n.newConcept?.parentId, toId) } : null,
      }
    })
}

function finalizeOne(
  out: LlmExtract,
  ep: ExtractInput['episodes'][number],
  i: number,
  subjectIds: Set<string>,
  toId: Map<string, string>,
): ExtractOutput['results'][number] {
  const r = out.results.find((x) => x.episodeId === ep.id) ?? out.results[i]
  if (!r) {
    return {
      episodeId: ep.id,
      isLearning: false,
      confidence: 0,
      reason: 'No result from the model',
      items: [],
      studentPrompts: [],
    }
  }
  const items = r.isLearning
    ? r.items.slice(0, 3).map((it) => {
        const evidence = it.evidence.trim()
        const status =
          (it.understanding === 'struggling' || it.understanding === 'understood') &&
          evidence.length < 8
            ? 'unknown'
            : it.understanding
        const matchId =
          it.subjectMatchId && subjectIds.has(it.subjectMatchId) ? it.subjectMatchId : null
        const topicPath = clean(it.topicPath, 4)
        const newName = matchId ? null : it.subjectNewName?.trim() || topicPath[0] || null
        return {
          subject: { matchId, newName },
          topicPath: topicPath.length ? topicPath : [newName ?? ep.title ?? ep.app],
          seen: it.seen.trim(),
          bigPicture: it.bigPicture.trim(),
          understanding: { status, evidence },
          openQuestions: clean(it.openQuestions, 3),
          keyTerms: clean(it.keyTerms, 10),
          assignment: it.assignment?.title.trim()
            ? {
                title: it.assignment.title.trim(),
                course: it.assignment.course?.trim() || null,
                dueAt:
                  it.assignment.dueAt && ISO_DATE.test(it.assignment.dueAt.trim())
                    ? it.assignment.dueAt.trim()
                    : null,
              }
            : null,
          notes: finalizeNotes(it.notes, toId),
        }
      })
    : []
  return {
    episodeId: ep.id,
    isLearning: r.isLearning,
    confidence: Math.min(1, Math.max(0, r.confidence)),
    reason: r.reason.trim(),
    items,
    studentPrompts:
      ep.kind === 'ai_chat'
        ? r.studentPrompts.filter((p) => p.text.trim()).map((p) => ({ ...p, text: p.text.trim() }))
        : [],
  }
}

export const extractPrompt: PromptSpec<ExtractInput, LlmExtract, ExtractOutput> = {
  id: 'P1',
  task: 'extract',
  version: 5,
  tier: 'extract',
  temperature: 0.1,
  maxOutputTokens: 2800,
  onDeviceMaxOutputTokens: 1600,
  reasoningEffort: 'low',
  schemaName: 'extraction',
  schema: LlmExtract,
  onDeviceOk: true,
  cacheable: true,
  language: (input) =>
    looksFinnish(input.episodes.map((e) => `${e.title ?? ''}\n${e.text}`).join('\n')) ? 'fi' : 'en',
  build: (input, ctx) => ({
    system: ctx.onDevice ? SYSTEM_COMPACT : SYSTEM_FULL,
    user: buildExtractUser(input, ctx.today),
  }),
  check(out, input) {
    const issues: string[] = []
    const ids = new Set(out.results.map((r) => r.episodeId))
    const missing = input.episodes.filter((e) => !ids.has(e.id)).map((e) => e.id)
    if (missing.length && out.results.length < input.episodes.length) {
      issues.push(`missing results for episodes: ${missing.join(', ')}`)
    }
    for (const r of out.results) {
      if (r.isLearning && r.items.length === 0)
        issues.push(`episode ${r.episodeId} is learning but has no items`)
    }
    return issues
  },
  finalize: finalizeExtract,
}
