/**
 * P3 Roadmapper (tier `reason`): goal + what memory knows about the student → the shortest
 * roadmap from where they are: learn steps (one idea, a teaching move, a prompt draft for their
 * AI) and checkpoints (covers, misconception probes). Post-processing enforces the checkpoint
 * rules of docs/PLAN.md §6.6 (spacing, a final checkpoint, carried concepts, question counts).
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

1. Map the territory: the concepts the goal needs, from prerequisites to core ideas to applications. Size to the goal: a narrow question → 3–5 learn steps; a chapter or topic → 6–10; a whole course → 10–15 (if it is bigger, cover only the first milestone and name the next one in nextMilestone; otherwise nextMilestone is null).
2. Find the starting point.
   - Skip concepts with solid evidence of mastery (status "mastered", passed checkpoints or exams).
   - Start at the earliest prerequisite that is not mastered or shows struggle ("struggling" status, "struggling"/"unclear" encounters, open questions).
   - Steps in <done_steps> are finished: never repeat them; continue after them.
   - startReason: one sentence to the student ("you"), citing the evidence, e.g. "You already handle X; you stumbled on Y twice, so we start there."
   - offerPlacement: true only when there is no evidence at all (no mastery, encounters or done steps).
3. Time: if the deadline is within 2 days or little time is available, keep only the highest-yield steps (estimatedMinutes must fit the time available) and say so in startReason.
4. Learn steps: one idea each, 3–8 minutes, ordered so each step needs only earlier ones. objective is observable ("Can explain why…", "Can solve…"). move is one of intuition, definition, worked_example, contrast, apply, explain_back, predict, big_picture — vary them and include at least one explain_back or predict step. concepts: 1–3 short concept names; reuse names from <mastery> when they match.
5. Checkpoints: after every 2–3 learn steps and always as the last item. covers = the concepts taught since the previous checkpoint (the last checkpoint covers the roadmap's key concepts). probes = one per covered concept: the misconception a question should test. nQuestions = 3 plus 1 per carried concept it re-tests (max 5). Every concept in <carry> (missed before) must be in the covers and probes of the first checkpoint.
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
  ].join('\n')
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
  version: 1,
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
  check(plan) {
    const issues: string[] = []
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
