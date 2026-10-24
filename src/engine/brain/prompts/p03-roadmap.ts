/**
 * P3 Roadmapper (tier `reason`): goal + what memory knows about the student → the shortest
 * roadmap from where they are: learn steps (one idea, a teaching move, a prompt draft for their
 * AI) and checkpoints (covers, misconception probes). Post-processing enforces the checkpoint
 * rules of docs/PLAN.md §6.6 (spacing, a final checkpoint, carried concepts, question counts).
 * With the subject's structure (docs/NOTES.md §6: tree, prerequisites, key notes) it follows the
 * study order computed in code; `check` asks for a repair when steps break that order.
 */
import type { RoadmapInput, RoadmapPlan } from '@engine/brain-contract'
import { Probe, TeachingMove } from '@shared/domain'
import { z } from 'zod'
import { looksFinnish } from '../llm/text'
import {
  bullets,
  checkStudentPrompt,
  languageName,
  type PromptSpec,
  STUDENT_PROMPT_MAX_WORDS,
  studentPromptRules,
  tag,
  tidyStudentPrompt,
} from './shared'

const LlmLearn = z.object({
  kind: z.literal('learn'),
  title: z.string().min(1),
  objective: z.string(),
  concepts: z.array(z.string()),
  move: TeachingMove,
  promptDraft: z.string().min(1),
})
const LlmCheckpoint = z.object({
  kind: z.literal('checkpoint'),
  covers: z.array(z.string()),
  probes: z.array(Probe),
  nQuestions: z.number(),
})
/** Looser than the contract's RoadmapPlan: counts and spacing are fixed in finalizeRoadmap. */
export const LlmRoadmap = z
  .object({
    title: z.string(),
    goal: z.string(),
    startReason: z.string(),
    offerPlacement: z.boolean(),
    estimatedMinutes: z.number(),
    items: z.array(z.discriminatedUnion('kind', [LlmLearn, LlmCheckpoint])),
    nextMilestone: z.string().nullable(),
  })
  .refine((p) => p.items.some((i) => i.kind === 'learn'), {
    message: 'the roadmap needs at least one learn step',
    path: ['items'],
  })
export type LlmRoadmap = z.infer<typeof LlmRoadmap>

export function roadmapLanguage(input: RoadmapInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  const text = [input.goal, ...input.encounters.map((e) => e.seen), ...input.openQuestions].join(
    '\n',
  )
  return looksFinnish(text) ? 'fi' : 'en'
}

function system(input: RoadmapInput, lang: string): string {
  const a = input.assistant || 'their AI assistant'
  return `You are the curriculum designer of a study coach. Build the shortest path that takes this student from where they are now to genuinely understanding the goal. The teaching happens in the student's own AI assistant (${a}) through prompts you draft; short multiple-choice checkpoints prove understanding along the way.

1. Map the territory: the concepts the goal needs, from prerequisites to core ideas to applications. Size to the goal: a narrow question → 3–5 learn steps; a chapter or topic → 6–10; a whole course → 10–15 (if it is bigger, cover only the first milestone — still 6–10 learn steps — and name the next one in nextMilestone; otherwise nextMilestone is null).
2. Find the starting point.
   - Skip concepts with solid evidence of mastery (status "mastered", passed checkpoints or exams).
   - Start at the earliest prerequisite that is not mastered or shows struggle ("struggling" status, "struggling"/"unclear" encounters, open questions).
   - Steps in <done_steps> are finished: never repeat them; continue after them.
   - When <suggested_order> is given, it is the order to teach in: prerequisites first, mastered concepts already left out, the first item is where the student is ready to start. Keep that order (you may group, split or leave out concepts the goal does not need), and use the concept names from it. <prerequisites> says which concept needs which; <key_notes> is what the student has already read or highlighted — build on it in the prompt drafts ("You read that…"). "read in" in <tree> = pages read on it.
   - <preferences> is what the student asked this roadmap to cover. Never teach a concept listed under skip (not even as a side topic); start with the focus concepts (after any prerequisite they need, as <suggested_order> already shows), and let the goal follow the student's words.
   - startReason: one sentence to the student ("you"), citing the evidence, e.g. "You already handle X; you stumbled on Y twice, so we start there."
   - offerPlacement: true only when there is no evidence at all (no mastery, encounters or done steps).
3. Time: if the deadline is within 2 days or little time is available, keep only the highest-yield steps (estimatedMinutes must fit the time available) and say so in startReason.
4. Learn steps: one idea each, 3–8 minutes, ordered so each step needs only earlier ones. estimatedMinutes = the learn steps' minutes added up + 3 per checkpoint (never more than 8 per learn step). objective is observable ("Can explain why…", "Can solve…"). move is one of intuition, definition, worked_example, contrast, apply, explain_back, predict, big_picture — vary them and include at least one explain_back or predict step. concepts: 1–3 short concept names; reuse names from <mastery> when they match.
5. Checkpoints: never more than 3 learn steps in a row — put a checkpoint after every 2nd or 3rd learn step, and always one as the last item (e.g. learn, learn, checkpoint, learn, learn, learn, checkpoint). covers = the concepts taught since the previous checkpoint (the last checkpoint covers the roadmap's key concepts). probes = one per covered concept: the misconception a question should test. nQuestions = 3 plus 1 per carried concept it re-tests (max 5). Every concept in <carry> (missed before) must be in the covers and probes of the first checkpoint.
6. promptDraft for every learn step: the exact message the student will paste into ${a} to learn that step. Make it specific to the objective and the move (predict: "Before you explain, ask me to predict…"; worked_example: "Walk me through one example step by step"; explain_back: "Let me explain X back to you, then correct my mistakes"; contrast: "Show how X differs from Y with one example each").

${studentPromptRules(a, lang)}

Write titles, objectives, startReason and prompt drafts in ${languageName(lang)}. Return JSON only.`
}

function user(input: RoadmapInput, today: string): string {
  const mastery = input.mastery.map(
    (m) => `${m.concept} — ${m.status}${m.evidence ? ` — ${m.evidence}` : ''}`,
  )
  const encounters = input.encounters
    .slice(0, 20)
    .map((e) => `[${e.understanding}] seen: ${e.seen} · big picture: ${e.bigPicture}`)
  return [
    tag('goal', input.goal),
    tag('subject', input.subject?.name ?? '(new subject)'),
    tag('today', today),
    tag('deadline', input.deadline ?? 'none'),
    tag(
      'time_available',
      input.minutesAvailable != null ? `${input.minutesAvailable} minutes` : 'unknown',
    ),
    tag('student', input.profile || '(no profile)'),
    tag('mastery', bullets(mastery)),
    tag('encounters', bullets(encounters)),
    tag('open_questions', bullets(input.openQuestions.slice(0, 10))),
    tag('done_steps', bullets(input.doneSteps)),
    tag('carry', bullets(input.carry)),
    ...structureTags(input),
    ...preferencesTag(input),
  ].join('\n')
}

/** The subject's structure, when memory has one (docs/NOTES.md §6). */
function structureTags(input: RoadmapInput): string[] {
  const tree = input.tree ?? []
  if (tree.length === 0) return []
  const name = new Map(tree.map((c) => [c.id, c.name]))
  const depth = (id: string | null): number => {
    let d = 0
    for (let x = id; x && d < 6; d++) x = tree.find((c) => c.id === x)?.parentId ?? null
    return d
  }
  const lines = tree.map(
    (c) =>
      `${'  '.repeat(depth(c.parentId))}- ${c.name} [${c.status} ${c.mastery.toFixed(2)}]${c.summary ? `: ${c.summary}` : ''}${c.sources?.length ? ` (read in: ${c.sources.join('; ')})` : ''}`,
  )
  const prereqs = (input.edges ?? []).flatMap((e) => {
    const a = name.get(e.fromId)
    const b = name.get(e.toId)
    return a && b ? [`${a} → ${b}`] : []
  })
  const notes = (input.keyNotes ?? []).flatMap((n) => {
    const c = name.get(n.conceptId)
    return c ? [`${c}: ${n.text}`] : []
  })
  const order = (input.suggestedOrder ?? []).map((c, i) => `${i + 1}. ${c}`)
  return [
    tag('tree', lines.join('\n')),
    tag('prerequisites', bullets(prereqs)),
    tag('key_notes', bullets(notes)),
    tag('suggested_order', order.join('\n') || '(none)'),
  ]
}

/** What the student asked the roadmap to cover (adjust_roadmap), when they said anything. */
function preferencesTag(input: RoadmapInput): string[] {
  const p = input.preferences
  if (!p) return []
  const list = (xs: string[]) => xs.join(', ') || '(none)'
  return [
    tag(
      'preferences',
      `student said: ${p.instruction}\nfocus: ${list(p.focus)}\nskip: ${list(p.skip)}`,
    ),
  ]
}

/** Learn steps that teach a concept the student asked to skip. */
export function skipIssues(plan: LlmRoadmap, input: RoadmapInput): string[] {
  const skip = (input.preferences?.skip ?? []).map(norm)
  if (skip.length === 0) return []
  const issues: string[] = []
  plan.items.forEach((item, i) => {
    if (item.kind !== 'learn') return
    const hit = item.concepts.find((c) => skip.includes(norm(c)))
    if (hit) issues.push(`items.${i}: teaches "${hit}", which the student asked to skip`)
  })
  return issues
}

/**
 * Learn steps that teach a concept before one that comes earlier in the study order. Only names
 * found in the order count; grouping and leaving concepts out are fine.
 */
export function orderIssues(plan: LlmRoadmap, input: RoadmapInput): string[] {
  const order = (input.suggestedOrder ?? []).map(norm)
  if (order.length < 2) return []
  const issues: string[] = []
  let highest = -1
  let highestName = ''
  plan.items.forEach((item, i) => {
    if (item.kind !== 'learn') return
    const ranks = item.concepts.map((c) => order.indexOf(norm(c))).filter((r) => r >= 0)
    if (ranks.length === 0) return
    const first = Math.min(...ranks)
    if (first < highest)
      issues.push(
        `items.${i}: teaches "${input.suggestedOrder?.[first]}" after "${highestName}"; follow <suggested_order>`,
      )
    if (Math.max(...ranks) > highest) {
      highest = Math.max(...ranks)
      highestName = input.suggestedOrder?.[highest] ?? ''
    }
  })
  return issues
}

type Item = RoadmapPlan['items'][number]
type Checkpoint = Extract<Item, { kind: 'checkpoint' }>

const norm = (s: string) => s.trim().toLowerCase()

function checkpoint(covers: string[], carry: string[], probes: Probe[] = []): Checkpoint {
  const uniq = [
    ...new Map(covers.filter((c) => c.trim()).map((c) => [norm(c), c.trim()])).values(),
  ].slice(0, 6)
  const carried = uniq.filter((c) => carry.some((k) => norm(k) === norm(c))).length
  return { kind: 'checkpoint', covers: uniq, probes, nQuestions: Math.min(5, 3 + carried) }
}

export function finalizeRoadmap(plan: LlmRoadmap, input: RoadmapInput, lang: string): RoadmapPlan {
  const items: Item[] = []
  let sinceCheckpoint: string[] = []
  let learnRun = 0
  for (const raw of plan.items) {
    if (raw.kind === 'learn') {
      if (learnRun === 3) {
        items.push(checkpoint(sinceCheckpoint, input.carry))
        sinceCheckpoint = []
        learnRun = 0
      }
      const concepts = raw.concepts.map((c) => c.trim()).filter(Boolean)
      items.push({
        ...raw,
        concepts: concepts.length ? concepts : [raw.title],
        promptDraft: tidyStudentPrompt(raw.promptDraft, lang),
      })
      sinceCheckpoint.push(...concepts)
      learnRun++
    } else {
      if (learnRun === 0 && items.length > 0) continue // drop back-to-back checkpoints
      const covers = raw.covers.length ? raw.covers : sinceCheckpoint
      items.push({ ...checkpoint(covers, input.carry, raw.probes), probes: raw.probes })
      sinceCheckpoint = []
      learnRun = 0
    }
  }
  if (items.length && items[items.length - 1]?.kind !== 'checkpoint') {
    const all = items.flatMap((i) => (i.kind === 'learn' ? i.concepts : []))
    items.push(checkpoint(learnRun > 0 ? [...sinceCheckpoint, ...all] : all, input.carry))
  }
  // Carried concepts must be re-tested at the first checkpoint.
  const first = items.find((i): i is Checkpoint => i.kind === 'checkpoint')
  if (first && input.carry.length) {
    for (const c of input.carry) {
      if (!first.covers.some((x) => norm(x) === norm(c))) first.covers.push(c)
      if (!first.probes.some((p) => norm(p.concept) === norm(c))) {
        first.probes.push({
          concept: c,
          misconception: 'Missed in an earlier checkpoint — re-test with a new scenario',
        })
      }
    }
    const carried = first.covers.filter((x) => input.carry.some((k) => norm(k) === norm(x))).length
    first.nQuestions = Math.min(5, 3 + carried)
  }
  const learnSteps = items.filter((i) => i.kind === 'learn').length
  const noEvidence = !input.mastery.length && !input.encounters.length && !input.doneSteps.length
  return {
    ...plan,
    items,
    offerPlacement: noEvidence,
    estimatedMinutes:
      plan.estimatedMinutes > 0
        ? Math.round(plan.estimatedMinutes)
        : learnSteps * 5 + (items.length - learnSteps) * 3,
    nextMilestone: plan.nextMilestone?.trim() ? plan.nextMilestone.trim() : null,
  }
}

export const roadmapPrompt: PromptSpec<RoadmapInput, LlmRoadmap, RoadmapPlan> = {
  id: 'P3',
  task: 'buildRoadmap',
  version: 5,
  tier: 'reason',
  temperature: 0.3,
  maxOutputTokens: 6000,
  reasoningEffort: 'medium',
  schemaName: 'roadmap',
  schema: LlmRoadmap,
  onDeviceOk: false,
  cacheable: true,
  language: roadmapLanguage,
  build: (input, ctx) => {
    const lang = roadmapLanguage(input)
    return { system: system(input, lang), user: user(input, ctx.today) }
  },
  check(plan, input) {
    const issues: string[] = [...orderIssues(plan, input), ...skipIssues(plan, input)]
    plan.items.forEach((item, i) => {
      if (item.kind !== 'learn') return
      const words = checkStudentPrompt(item.promptDraft, {
        maxWords: STUDENT_PROMPT_MAX_WORDS + 10,
      }).filter((x) => x.includes('words'))
      for (const w of words) issues.push(`items.${i}.promptDraft: ${w}`)
    })
    if (
      !plan.items.some(
        (i) => i.kind === 'learn' && (i.move === 'explain_back' || i.move === 'predict'),
      )
    ) {
      issues.push('include at least one explain_back or predict learn step')
    }
    return issues
  },
  finalize: (plan, input) => finalizeRoadmap(plan, input, roadmapLanguage(input)),
}
