/**
 * Step-prompt + improver eval (PLAN §9.2): 15 step-writer and 15 improver cases → ≤ 110 words,
 * brevity rule, no greeting, first-person context line, intent kept (keyword groups), no quiz hook
 * for quick facts, right language. Graded on the raw model output and on the final (tidied) text;
 * also reports how many raw answers would have met the 2.5 s write budget.
 */
import { ImproveInput, StepInput } from '@engine/brain-contract'
import { looksFinnish } from '../llm/text'
import { stepPrompt } from '../prompts/p04-step'
import { improvePrompt } from '../prompts/p08-improve'
import { checkStudentPrompt } from '../prompts/shared'
import {
  atLeast,
  type CaseRow,
  clipText,
  type EvalContext,
  loadFixture,
  pool,
  quote,
  ratio,
  runRaw,
  type SuiteResult,
  take,
} from './common'

interface Expect {
  mention: string[][]
  language: string
  noHook?: boolean
}
interface Fixture {
  profile: string
  step: { id: string; input: Omit<StepInput, 'profile'>; expect: Expect }[]
  improve: { id: string; input: Omit<ImproveInput, 'profile'>; expect: Expect }[]
}

const CHECKS = [
  'words',
  'brevity',
  'greeting',
  'context',
  'intent',
  'hook',
  'language',
  'dumbledore',
] as const
type Check = (typeof CHECKS)[number]

const HOOK = /ask me (one|a|1) question|quiz me|kysy (sitten )?minulta/i

export function gradePrompt(text: string, e: Expect): Record<Check, string | null> {
  const issues = checkStudentPrompt(text)
  const find = (re: RegExp) => issues.find((i) => re.test(i)) ?? null
  const lower = text.toLowerCase()
  const missing = e.mention.filter(
    (group) => !group.some((alt) => lower.includes(alt.toLowerCase())),
  )
  const fi = looksFinnish(text)
  return {
    words: find(/words; the limit/),
    brevity: find(/brevity/),
    greeting: find(/greeting/),
    context: find(/first line|first person/),
    intent: missing.length ? `missing ${missing.map((g) => g[0]).join(', ')}` : null,
    hook: e.noHook && HOOK.test(text) ? 'adds a quiz hook to a quick-fact request' : null,
    language:
      e.language === 'fi' ? (fi ? null : 'not Finnish') : fi ? 'Finnish instead of English' : null,
    dumbledore: find(/Dumbledore/),
  }
}

export async function runPrompts(ctx: EvalContext): Promise<SuiteResult> {
  const fx = loadFixture<Fixture>(ctx.root, 'prompts.json')
  type Item = {
    id: string
    kind: 'step' | 'improve'
    expect: Expect
    run: () => Promise<{ raw: string; final: string; tip: string }>
  }
  const items: Item[] = [
    ...fx.step.map((c) => ({
      id: c.id,
      kind: 'step' as const,
      expect: c.expect,
      run: async () => {
        const input = StepInput.parse({ ...c.input, profile: fx.profile })
        const raw = await runRaw(ctx, stepPrompt, input)
        return { raw: raw.prompt, final: stepPrompt.finalize(raw, input).prompt, tip: raw.coachTip }
      },
    })),
    ...fx.improve.map((c) => ({
      id: c.id,
      kind: 'improve' as const,
      expect: c.expect,
      run: async () => {
        const input = ImproveInput.parse({ ...c.input, profile: fx.profile })
        const raw = await runRaw(ctx, improvePrompt, input)
        const fin = improvePrompt.finalize(raw, input)
        return { raw: raw.prompt, final: fin.prompt, tip: fin.coachTip }
      },
    })),
  ]
  const cases = take(items, ctx.limit)
  const outs = await pool(cases, ctx.concurrency, (c, i) => {
    ctx.log(`prompt ${i + 1}/${cases.length}: ${c.id}`)
    return c.run()
  })
  const rawPass: Record<Check, number> = Object.fromEntries(CHECKS.map((k) => [k, 0])) as Record<
    Check,
    number
  >
  const finalPass: Record<Check, number> = Object.fromEntries(CHECKS.map((k) => [k, 0])) as Record<
    Check,
    number
  >
  let errors = 0
  let allFinal = 0
  const rows: CaseRow[] = []
  cases.forEach((c, i) => {
    const out = outs[i]
    if (!out || out instanceof Error) {
      errors++
      rows.push({ id: c.id, ok: false, summary: `error: ${out?.message ?? 'none'}`.slice(0, 200) })
      return
    }
    const rg = gradePrompt(out.raw, c.expect)
    const fg = gradePrompt(out.final, c.expect)
    for (const k of CHECKS) {
      if (!rg[k]) rawPass[k]++
      if (!fg[k]) finalPass[k]++
    }
    const failed = CHECKS.filter((k) => fg[k]).map((k) => `${k}: ${fg[k]}`)
    const rawOnly = CHECKS.filter((k) => rg[k] && !fg[k]).map((k) => `raw ${k} fixed by tidy`)
    if (failed.length === 0) allFinal++
    rows.push({
      id: `${c.kind}:${c.id}`,
      ok: failed.length === 0,
      summary: [...(failed.length ? failed : ['all checks pass']), ...rawOnly].join(' · '),
      detail: `${quote(clipText(out.final, 900))}\n\n  tip: ${out.tip}`,
    })
  })
  const done = cases.length - errors
  const fin = (k: Check) => ratio(finalPass[k], done)
  const writeCalls = ctx.records.filter(
    (r) => r.ok && (r.task === 'writeStep' || r.task === 'improvePrompt'),
  )
  const fast = writeCalls.filter((r) => r.latencyMs <= 2500).length
  return {
    suite: 'prompts',
    metrics: {
      cases: cases.length,
      errors,
      allChecksFinal: ratio(allFinal, done),
      ...Object.fromEntries(CHECKS.map((k) => [`final.${k}`, fin(k)])),
      ...Object.fromEntries(CHECKS.map((k) => [`raw.${k}`, ratio(rawPass[k], done)])),
      callsWithin2500ms: `${fast}/${writeCalls.length}`,
    },
    thresholds: [
      atLeast('≤ 110 words', fin('words'), 1),
      atLeast('brevity rule present', fin('brevity'), 1),
      atLeast('no greetings', fin('greeting'), 1),
      atLeast('context line present', fin('context'), 0.9),
      atLeast('intent preserved', fin('intent'), 0.9),
      atLeast('right language', fin('language'), 1),
      atLeast('no quiz hook on quick facts', fin('hook'), 1),
    ],
    cases: rows,
    notes: [
      'final = what the student sees (after tidyStudentPrompt); raw = the model output before clean-up.',
      'Evals use long timeouts; latency against the 2.5 s write budget is reported separately (callsWithin2500ms).',
    ],
  }
}
