/**
 * Roadmap eval (PLAN §9.2): 8 scenarios graded on the raw model output (before finalize fixes
 * structure) — correct start point, ≥ 1 checkpoint with correct spacing, carried concepts placed,
 * steps sized 3–8 min, prompt drafts following the student-prompt rules — plus size, placement,
 * language and the final (post-processed) plan's structure.
 */
import { RoadmapInput } from '@engine/brain-contract'
import { looksFinnish } from '../llm/text'
import {
  finalizeRoadmap,
  type LlmRoadmap,
  roadmapLanguage,
  roadmapPrompt,
} from '../prompts/p03-roadmap'
import { checkStudentPrompt } from '../prompts/shared'
import {
  atLeast,
  type CaseRow,
  clipText,
  type EvalContext,
  loadFixture,
  pool,
  ratio,
  runRaw,
  type SuiteResult,
  take,
} from './common'

interface Expect {
  offerPlacement: boolean
  learn: [number, number]
  startKeywords: string[]
  avoidStartKeywords: string[]
  carry: string[]
  language: string
  maxMinutes?: number
  nextMilestone?: boolean
  reasonMentions?: string[]
}
interface Fixture {
  cases: { id: string; input: RoadmapInput; expect: Expect }[]
}

const CHECKS = [
  'start',
  'checkpoints',
  'carry',
  'sizing',
  'drafts',
  'placement',
  'language',
  'extras',
] as const
type Check = (typeof CHECKS)[number]

const low = (s: string) => s.toLowerCase()

export function gradeRoadmap(plan: LlmRoadmap, e: Expect): Record<Check, string | null> {
  const learn = plan.items.filter((i) => i.kind === 'learn')
  const checkpoints = plan.items.filter((i) => i.kind === 'checkpoint')
  const first = learn[0]
  const firstText = first ? low(`${first.title} ${first.concepts.join(' ')}`) : ''
  const start = !first
    ? 'no learn step'
    : !e.startKeywords.some((k) => firstText.includes(low(k)))
      ? `starts with "${first.title}"`
      : e.avoidStartKeywords.some((k) => firstText.includes(low(k)))
        ? `starts with already-known "${first.title}"`
        : null
  let run = 0
  let maxRun = 0
  for (const item of plan.items) {
    run = item.kind === 'learn' ? run + 1 : 0
    maxRun = Math.max(maxRun, run)
  }
  const checkpointsIssue =
    checkpoints.length === 0
      ? 'no checkpoint'
      : plan.items.at(-1)?.kind !== 'checkpoint'
        ? 'does not end with a checkpoint'
        : maxRun > 3
          ? `${maxRun} learn steps in a row`
          : null
  const firstCp = checkpoints[0]
  const missingCarry = e.carry.filter(
    (c) => !firstCp?.covers.some((x) => low(x).includes(low(c)) || low(c).includes(low(x))),
  )
  const minutesPerStep = learn.length
    ? (plan.estimatedMinutes - checkpoints.length * 3) / learn.length
    : 0
  const sizing =
    learn.length < e.learn[0] || learn.length > e.learn[1]
      ? `${learn.length} learn steps (expected ${e.learn[0]}–${e.learn[1]})`
      : minutesPerStep < 2.5 || minutesPerStep > 9
        ? `${minutesPerStep.toFixed(1)} min per step`
        : e.maxMinutes && plan.estimatedMinutes > e.maxMinutes
          ? `${plan.estimatedMinutes} min > ${e.maxMinutes}`
          : null
  const draftIssues = learn.flatMap((l) =>
    checkStudentPrompt(l.promptDraft).map((i) => `"${l.title}": ${i}`),
  )
  const fi = learn.filter((l) => looksFinnish(l.promptDraft)).length
  const language =
    e.language === 'fi'
      ? fi === learn.length
        ? null
        : `${learn.length - fi} drafts not Finnish`
      : fi
        ? `${fi} drafts in Finnish`
        : null
  const extras: string[] = []
  if (e.nextMilestone && !plan.nextMilestone?.trim()) extras.push('nextMilestone missing')
  if (e.reasonMentions && !e.reasonMentions.some((k) => low(plan.startReason).includes(low(k)))) {
    extras.push('startReason ignores the time pressure')
  }
  if (!learn.some((l) => l.move === 'explain_back' || l.move === 'predict'))
    extras.push('no explain_back/predict step')
  return {
    start,
    checkpoints: checkpointsIssue,
    carry: missingCarry.length ? `carry not in first checkpoint: ${missingCarry.join(', ')}` : null,
    sizing,
    drafts: draftIssues.length ? draftIssues.slice(0, 3).join('; ') : null,
    placement:
      plan.offerPlacement === e.offerPlacement ? null : `offerPlacement ${plan.offerPlacement}`,
    language,
    extras: extras.length ? extras.join('; ') : null,
  }
}

export async function runRoadmaps(ctx: EvalContext): Promise<SuiteResult> {
  const fx = loadFixture<Fixture>(ctx.root, 'roadmaps.json')
  const cases = take(fx.cases, ctx.limit)
  const outs = await pool(cases, ctx.concurrency, (c, i) => {
    ctx.log(`roadmap ${i + 1}/${cases.length}: ${c.id}`)
    return runRaw(ctx, roadmapPrompt, RoadmapInput.parse(c.input))
  })
  const passes: Record<Check, number> = Object.fromEntries(CHECKS.map((k) => [k, 0])) as Record<
    Check,
    number
  >
  let errors = 0
  let finalOk = 0
  let draftsTotal = 0
  let draftsOk = 0
  const rows: CaseRow[] = []
  cases.forEach((c, i) => {
    const out = outs[i]
    if (!out || out instanceof Error) {
      errors++
      rows.push({ id: c.id, ok: false, summary: `error: ${out?.message ?? 'none'}`.slice(0, 200) })
      return
    }
    const grade = gradeRoadmap(out, c.expect)
    for (const k of CHECKS) if (!grade[k]) passes[k]++
    const learn = out.items.filter((x) => x.kind === 'learn')
    draftsTotal += learn.length
    draftsOk += learn.filter((l) => checkStudentPrompt(l.promptDraft).length === 0).length
    const final = finalizeRoadmap(out, c.input, roadmapLanguage(c.input))
    const fg = gradeRoadmap(final as LlmRoadmap, c.expect)
    if (!fg.checkpoints && !fg.carry) finalOk++
    const failed = CHECKS.filter((k) => grade[k]).map((k) => `${k}: ${grade[k]}`)
    rows.push({
      id: c.id,
      ok: failed.length === 0,
      summary: failed.length ? failed.join(' · ') : 'all checks pass',
      detail: [
        `- **${out.title}** — ${out.estimatedMinutes} min — start: ${out.startReason}`,
        ...out.items.map((it, k) =>
          it.kind === 'learn'
            ? `  ${k + 1}. [${it.move}] ${it.title} — ${it.objective}\n     draft: ${clipText(it.promptDraft.replace(/\n/g, ' ⏎ '), 260)}`
            : `  ${k + 1}. ✅ checkpoint (${it.nQuestions}q): ${it.covers.join(', ')}`,
        ),
        out.nextMilestone ? `- next milestone: ${out.nextMilestone}` : '',
      ]
        .filter(Boolean)
        .join('\n'),
    })
  })
  const done = cases.length - errors
  const rate = (k: Check) => ratio(passes[k], done)
  return {
    suite: 'roadmaps',
    metrics: {
      scenarios: cases.length,
      errors,
      ...Object.fromEntries(CHECKS.map((k) => [`raw.${k}`, rate(k)])),
      draftsFollowingRules: `${draftsOk}/${draftsTotal}`,
      finalStructureOk: `${finalOk}/${done}`,
    },
    thresholds: [
      atLeast('correct start point', rate('start'), 0.875),
      atLeast('≥ 1 checkpoint, correct spacing (raw)', rate('checkpoints'), 0.875),
      atLeast('carry concepts placed (raw)', rate('carry'), 0.875),
      atLeast('steps sized 3–8 min, size fits goal', rate('sizing'), 0.875),
      atLeast('prompt drafts follow the rules', ratio(draftsOk, draftsTotal), 0.9),
      atLeast('final plans structurally valid', ratio(finalOk, done), 1),
    ],
    cases: rows,
    notes: [
      'Graded on the raw model output; finalizeRoadmap() then enforces spacing, the final checkpoint and carried concepts deterministically.',
    ],
  }
}
