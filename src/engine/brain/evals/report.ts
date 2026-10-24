/**
 * Eval reports: Markdown in docs/evals/<date>-<suite>.md (later runs the same day get -r2, -r3…)
 * plus one JSON line per run in docs/evals/history.jsonl so prompt iterations stay comparable.
 */
import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import type { LlmCallRecord } from '../../contracts'
import { type SuiteResult, usageTable } from './common'

export interface RunMeta {
  startedAt: Date
  durationMs: number
  routes: string
  promptVersions: string
  args: string
}

export function localDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function renderReport(r: SuiteResult, meta: RunMeta, records: LlmCallRecord[]): string {
  const passAll = r.thresholds.every((t) => t.pass)
  const lines = [
    `# Eval · ${r.suite} · ${meta.startedAt.toISOString()}`,
    '',
    `Result: **${passAll ? 'PASS' : 'GAP'}** — ${r.thresholds.filter((t) => t.pass).length}/${r.thresholds.length} thresholds met · ${Math.round(meta.durationMs / 1000)} s · \`${meta.args}\``,
    '',
    `Routes: ${meta.routes}`,
    '',
    `Prompt versions: ${meta.promptVersions}`,
    '',
    '## Thresholds (PLAN §9.2)',
    '',
    '| metric | value | target | |',
    '|---|---|---|---|',
    ...r.thresholds.map(
      (t) => `| ${t.name} | ${t.value} | ${t.target} | ${t.pass ? '✅' : '❌'} |`,
    ),
    '',
    '## Metrics',
    '',
    ...Object.entries(r.metrics).map(([k, v]) => `- ${k}: ${v}`),
    '',
    '## Models used',
    '',
    usageTable(records),
    '',
  ]
  if (r.notes.length) lines.push('## Notes', '', ...r.notes.map((n) => `- ${n}`), '')
  lines.push('## Cases', '')
  for (const c of r.cases) {
    lines.push(`### ${c.ok ? '✅' : '❌'} ${c.id}`, '', c.summary, '')
    if (c.detail) lines.push(c.detail, '')
  }
  return lines.join('\n')
}

export function writeReport(
  root: string,
  r: SuiteResult,
  meta: RunMeta,
  records: LlmCallRecord[],
): string {
  const dir = resolve(root, 'docs/evals')
  mkdirSync(dir, { recursive: true })
  const date = localDate(meta.startedAt)
  let path = resolve(dir, `${date}-${r.suite}.md`)
  for (let n = 2; existsSync(path); n++) path = resolve(dir, `${date}-${r.suite}-r${n}.md`)
  writeFileSync(path, renderReport(r, meta, records))
  const models = [...new Set(records.map((x) => `${x.provider}:${x.model}`))]
  appendFileSync(
    resolve(dir, 'history.jsonl'),
    `${JSON.stringify({
      at: meta.startedAt.toISOString(),
      suite: r.suite,
      file: path.slice(dir.length + 1),
      pass: r.thresholds.every((t) => t.pass),
      thresholds: Object.fromEntries(r.thresholds.map((t) => [t.name, t.value])),
      models,
      prompts: meta.promptVersions,
      args: meta.args,
    })}\n`,
  )
  return path
}
