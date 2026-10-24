/**
 * Shared eval plumbing: result shapes, thresholds, a small concurrency pool, fixture loading and
 * per-model usage/latency stats from the usage log. Used by tools/eval-prompts.ts (never by the app).
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { systemClock } from '../../clock'
import type { LlmCallRecord } from '../../contracts'
import { type BrainHandle, today } from '../brain'
import { runStructured } from '../llm/structured'
import type { PromptSpec } from '../prompts/shared'

export interface Threshold {
  name: string
  value: number
  target: string
  pass: boolean
}

export interface CaseRow {
  id: string
  ok: boolean
  summary: string
  /** Markdown detail shown under the case (output excerpts). */
  detail?: string
}

export interface SuiteResult {
  suite: string
  metrics: Record<string, number | string>
  thresholds: Threshold[]
  cases: CaseRow[]
  notes: string[]
}

export interface EvalContext {
  brain: BrainHandle
  /** Every LLM call made during the run (from the brain's usage log). */
  records: LlmCallRecord[]
  root: string
  limit: number | null
  concurrency: number
  timeoutMs: number
  log: (line: string) => void
}

export const atLeast = (name: string, value: number, min: number): Threshold => ({
  name,
  value,
  target: `≥ ${min}`,
  pass: value >= min,
})
export const atMost = (name: string, value: number, max: number): Threshold => ({
  name,
  value,
  target: `≤ ${max}`,
  pass: value <= max,
})

export function ratio(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1000) / 1000
}

export function loadFixture<T>(root: string, name: string): T {
  return JSON.parse(readFileSync(resolve(root, 'tests/fixtures/llm', name), 'utf8')) as T
}

/** Runs `fn` over items with at most `n` in flight, keeping order; failures become `Error`s. */
export async function pool<T, R>(
  items: T[],
  n: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<(R | Error)[]> {
  const out: (R | Error)[] = new Array(items.length)
  let next = 0
  const worker = async () => {
    for (;;) {
      const i = next++
      if (i >= items.length) return
      try {
        out[i] = await fn(items[i] as T, i)
      } catch (err) {
        out[i] = err instanceof Error ? err : new Error(String(err))
      }
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(n, items.length)) }, worker))
  return out
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] as number
}

/** Calls, failures, tokens and latency per provider:model and task. */
export function usageTable(records: LlmCallRecord[]): string {
  if (records.length === 0) return '(no calls)'
  const groups = new Map<string, LlmCallRecord[]>()
  for (const r of records) {
    const key = `${r.provider}:${r.model} | ${r.task}`
    groups.set(key, [...(groups.get(key) ?? []), r])
  }
  const lines = [
    '| provider:model | task | calls | failures | tokens in/out | latency p50 / p90 (ms) |',
    '|---|---|---|---|---|---|',
  ]
  for (const [key, rs] of groups) {
    const ok = rs.filter((r) => r.ok)
    const lat = ok.map((r) => r.latencyMs)
    const tin = rs.reduce((n, r) => n + r.tokensIn, 0)
    const tout = rs.reduce((n, r) => n + r.tokensOut, 0)
    lines.push(
      `| ${key} | ${rs.length} | ${rs.length - ok.length} | ${tin} / ${tout} | ${percentile(lat, 50)} / ${percentile(lat, 90)} |`,
    )
  }
  const failures = records
    .filter((r) => !r.ok)
    .map((r) => `${r.provider}:${r.model} ${r.task}: ${r.error}`)
  if (failures.length)
    lines.push('', 'Failed calls:', ...failures.slice(0, 15).map((f) => `- ${f}`))
  return lines.join('\n')
}

export const clipText = (s: string, n = 400) => (s.length > n ? `${s.slice(0, n)}…` : s)
export const quote = (s: string) =>
  s
    .split('\n')
    .map((l) => `> ${l}`)
    .join('\n')
export const take = <T>(xs: T[], limit: number | null) => (limit == null ? xs : xs.slice(0, limit))

/** The validated model output of a prompt before its finalize step (to grade raw compliance). */
export function runRaw<I, L, O>(ctx: EvalContext, spec: PromptSpec<I, L, O>, input: I): Promise<L> {
  const raw: PromptSpec<I, L, L> = { ...spec, finalize: (o) => o }
  return runStructured(
    { router: ctx.brain.router, cache: null, clock: systemClock, today: () => today(systemClock) },
    raw,
    input,
    { timeoutMs: ctx.timeoutMs, noCache: true },
  )
}
