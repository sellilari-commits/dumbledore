/**
 * Eval CLI body (launched by tools/eval-prompts.ts under tsconfig.node.json so aliases resolve).
 *   eval-prompts [extraction|roadmaps|quizzes|prompts|all] [--limit N]
 *                [--provider gemini|ovh|groq|mistral] [--route tier=provider:model[,provider:model]]
 *                [--concurrency N] [--timeout ms] [--max-eur N] [--no-write]
 * Calls real providers: Gemini (paid; GEMINI_API_KEY via env, .env.local or DUMBLEDORE_ENV_FILES),
 * OVHcloud (keyless), Groq / Mistral when their keys exist. --max-eur (default 0.50) is the spend
 * cap for the whole invocation: once reached, paid routes are skipped as over-budget.
 */
import type { LlmTier, ModelRoute, ProviderId } from '@shared/llm'
import type { LlmCallRecord, UsageRepo } from '../../contracts'
import { createBrain } from '../brain'
import { costEur, formatEur } from '../llm/prices'
import { parseRouteList, resolveRoutes } from '../llm/routes'
import { extractPrompt } from '../prompts/p01-extract'
import { roadmapPrompt } from '../prompts/p03-roadmap'
import { stepPrompt } from '../prompts/p04-step'
import { checkpointPrompt, verifyPrompt } from '../prompts/p05-quiz'
import { improvePrompt } from '../prompts/p08-improve'
import type { EvalContext, SuiteResult } from './common'
import { type RunMeta, renderReport, writeReport } from './report'
import { runExtraction } from './suite-extraction'
import { runPrompts } from './suite-prompts'
import { runQuizzes } from './suite-quizzes'
import { runRoadmaps } from './suite-roadmaps'

const SUITES: Record<string, (ctx: EvalContext) => Promise<SuiteResult>> = {
  extraction: runExtraction,
  roadmaps: runRoadmaps,
  quizzes: runQuizzes,
  prompts: runPrompts,
}
const TIERS: LlmTier[] = ['triage', 'extract', 'reason', 'write', 'chat']

interface Args {
  suites: string[]
  limit: number | null
  provider: ProviderId | null
  routes: Partial<Record<LlmTier, ModelRoute[]>>
  concurrency: number
  timeoutMs: number
  maxEur: number
  write: boolean
}

export function parseArgs(argv: string[]): Args {
  const args: Args = {
    suites: [],
    limit: null,
    provider: null,
    routes: {},
    concurrency: 2,
    timeoutMs: 600_000,
    maxEur: 0.5,
    write: true,
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i] as string
    const next = () => argv[++i] ?? ''
    if (a === '--limit') args.limit = Number(next())
    else if (a === '--provider') args.provider = next() as ProviderId
    else if (a === '--concurrency') args.concurrency = Math.max(1, Number(next()))
    else if (a === '--timeout') args.timeoutMs = Number(next())
    else if (a === '--max-eur') args.maxEur = Math.max(0, Number(next()) || 0)
    else if (a === '--no-write') args.write = false
    else if (a === '--route') {
      const [tier, list] = next().split('=')
      if (tier && list && TIERS.includes(tier as LlmTier))
        args.routes[tier as LlmTier] = parseRouteList(list)
    } else if (a === 'all') args.suites.push(...Object.keys(SUITES))
    else if (SUITES[a]) args.suites.push(a)
    else throw new Error(`unknown argument "${a}"`)
  }
  if (args.suites.length === 0) args.suites = Object.keys(SUITES)
  return args
}

function recordingUsage(records: LlmCallRecord[]): UsageRepo {
  return {
    record: (c) => void records.push(c),
    rowsSince(sinceIso) {
      const rows = new Map<string, ReturnType<UsageRepo['rowsSince']>[number]>()
      for (const r of records.filter((x) => x.at >= sinceIso)) {
        const key = `${r.provider}:${r.model}`
        const row = rows.get(key) ?? {
          provider: r.provider,
          model: r.model,
          calls: 0,
          failures: 0,
          tokensIn: 0,
          tokensOut: 0,
        }
        row.calls++
        if (!r.ok) row.failures++
        row.tokensIn += r.tokensIn
        row.tokensOut += r.tokensOut
        rows.set(key, row)
      }
      return [...rows.values()]
    },
    countSince(provider, model, sinceIso) {
      const rs = records.filter(
        (r) => r.provider === provider && r.model === model && r.at >= sinceIso,
      )
      return { requests: rs.length, tokens: rs.reduce((n, r) => n + r.tokensIn + r.tokensOut, 0) }
    },
  }
}

export async function main(argv: string[], root = process.cwd()): Promise<number> {
  const args = parseArgs(argv)
  const records: LlmCallRecord[] = []
  const routeFor = (tier: LlmTier): ModelRoute[] => {
    const base = args.routes[tier] ?? resolveRoutes(tier, null)
    return args.provider ? base.filter((r) => r.provider === args.provider) : base
  }
  const brain = createBrain({
    usage: recordingUsage(records),
    cache: null,
    helper: null,
    routes: routeFor,
    spendCapEur: args.maxEur,
  })
  const routesText = TIERS.map(
    (t) =>
      `${t}: ${routeFor(t)
        .map((r) => `${r.provider}:${r.model}`)
        .join(' → ')}`,
  ).join(' · ')
  const versions = [
    extractPrompt,
    roadmapPrompt,
    stepPrompt,
    checkpointPrompt,
    verifyPrompt,
    improvePrompt,
  ]
    .map((p) => `${p.id}v${p.version}`)
    .join(' ')
  const log = (line: string) => process.stdout.write(`  · ${line}\n`)
  let allPass = true
  for (const suite of args.suites) {
    const startIdx = records.length
    const startedAt = new Date()
    process.stdout.write(`\n▶ ${suite}\n`)
    const result = await (SUITES[suite] as (ctx: EvalContext) => Promise<SuiteResult>)({
      brain,
      records,
      root,
      limit: args.limit,
      concurrency: args.concurrency,
      timeoutMs: args.timeoutMs,
      log,
    })
    const meta: RunMeta = {
      startedAt,
      durationMs: Date.now() - startedAt.getTime(),
      routes: routesText,
      promptVersions: versions,
      args: ['eval-prompts', ...argv].join(' '),
    }
    const suiteRecords = records.slice(startIdx)
    const spent = suiteRecords.reduce(
      (n, r) => n + costEur(r.provider, r.model, r.tokensIn, r.tokensOut),
      0,
    )
    process.stdout.write(
      `  ${formatEur(spent)} this suite · ${formatEur(brain.spend().eur)} of ${formatEur(args.maxEur)} this run\n`,
    )
    for (const t of result.thresholds) {
      process.stdout.write(`  ${t.pass ? '✓' : '✗'} ${t.name}: ${t.value} (${t.target})\n`)
    }
    allPass &&= result.thresholds.every((t) => t.pass)
    if (args.write) process.stdout.write(`  → ${writeReport(root, result, meta, suiteRecords)}\n`)
    else process.stdout.write(`${renderReport(result, meta, suiteRecords)}\n`)
  }
  return allPass ? 0 : 2
}
