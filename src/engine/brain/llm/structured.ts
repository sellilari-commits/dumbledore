/**
 * Runs one PromptSpec through the router with structured output: JSON-schema mode where the
 * provider supports it (plain JSON mode + schema in the instructions otherwise), local zod
 * validation, one repair call carrying the validation errors, an optional soft-rule repair when
 * time allows, and the 24 h response cache.
 */
import type { CallOptions } from '@engine/brain-contract'
import type { ZodType } from 'zod'
import type { Clock } from '../../clock'
import type { BuildContext, BuiltPrompt, PromptSpec } from '../prompts/shared'
import { cacheKey, type ResponseCache } from './cache'
import { parseJsonLenient, summarizeIssues, toProviderSchema } from './json'
import { type Attempt, InvalidOutputError, type Router } from './router'
import { estimateMessagesTokens } from './text'
import type { BackendResult, ChatTurn, JsonSchema } from './types'

/** Default deadlines per task (ms) when the caller passes no `timeoutMs`. */
export const DEFAULT_TIMEOUTS: Record<string, number> = {
  extract: 60_000,
  buildRoadmap: 45_000,
  writeStep: 2_500,
  makeCheckpoint: 30_000,
  verifyQuestions: 20_000,
  makeExam: 40_000,
  fixGaps: 15_000,
  improvePrompt: 6_000,
  suggestPrompt: 6_000,
  writeNudge: 8_000,
  buildProfile: 30_000,
  coach: 45_000,
}

export interface RunnerDeps {
  router: Router
  cache: ResponseCache | null
  clock: Clock
  /** Local "today" for prompts, e.g. "2026-10-24 (Saturday)". */
  today: () => string
}

const schemaCache = new WeakMap<ZodType, JsonSchema>()
function providerSchema(schema: ZodType): JsonSchema {
  let s = schemaCache.get(schema)
  if (!s) {
    s = toProviderSchema(schema)
    schemaCache.set(schema, s)
  }
  return s
}

type Validation<L> = { ok: true; value: L } | { ok: false; issues: string[] }

function validate<L>(schema: ZodType<L>, text: string): Validation<L> {
  const parsed = parseJsonLenient(text)
  if (!parsed.ok) return { ok: false, issues: [parsed.error] }
  const r = schema.safeParse(parsed.value)
  return r.success ? { ok: true, value: r.data } : { ok: false, issues: summarizeIssues(r.error) }
}

function repairMessage(issues: string[]): string {
  return [
    'Your JSON answer did not pass validation:',
    ...issues.map((i) => `- ${i}`),
    'Return the complete corrected JSON object only, with every required field.',
  ].join('\n')
}

function softRepairMessage(issues: string[]): string {
  return [
    'Your answer breaks these rules:',
    ...issues.map((i) => `- ${i}`),
    'Fix them and return the complete corrected JSON object only. Keep everything else unchanged.',
  ].join('\n')
}

export function deadlineFor(task: string, clock: Clock, opts?: CallOptions): number {
  return clock.now() + (opts?.timeoutMs ?? DEFAULT_TIMEOUTS[task] ?? 30_000)
}

/** The provider-side text of a prompt: schema in the instructions when the model lacks schema mode. */
function systemFor(built: BuiltPrompt, schema: JsonSchema, useSchemaMode: boolean): string {
  if (useSchemaMode) return `${built.system}\n\nReturn only a JSON object.`
  return `${built.system}\n\nReturn only a JSON object that matches this JSON Schema:\n${JSON.stringify(schema)}`
}

export async function runStructured<I, L, O>(
  deps: RunnerDeps,
  spec: PromptSpec<I, L, O>,
  input: I,
  opts?: CallOptions & { deadline?: number; noCache?: boolean },
): Promise<O> {
  const ctxCloud: BuildContext = { onDevice: false, today: deps.today() }
  const cloud = spec.build(input, ctxCloud)
  const device = spec.onDeviceOk ? spec.build(input, { ...ctxCloud, onDevice: true }) : null
  const schema = providerSchema(spec.schema)
  const key =
    spec.cacheable && !opts?.noCache
      ? cacheKey([spec.task, spec.version, cloud.system, cloud.user])
      : null
  if (key && deps.cache) {
    const hit = deps.cache.get(key)
    if (hit !== undefined) {
      const again = spec.schema.safeParse(hit)
      if (again.success) return spec.finalize(again.data, input)
    }
  }
  const deadline = opts?.deadline ?? deadlineFor(spec.task, deps.clock, opts)
  const estimate = (b: BuiltPrompt) =>
    estimateMessagesTokens(b.system, [{ content: b.user }]) +
    Math.ceil(JSON.stringify(schema).length / 4)

  const value = await deps.router.run(
    {
      task: spec.task,
      tier: spec.tier,
      deadline,
      signal: opts?.signal,
      estimatedTokens: estimate(cloud) + spec.maxOutputTokens,
      outputTokens: spec.maxOutputTokens,
      language: spec.language(input),
      onDeviceOk: device !== null,
      onDeviceTokens: device
        ? estimate(device) + (spec.onDeviceMaxOutputTokens ?? spec.maxOutputTokens)
        : undefined,
    },
    (a) =>
      attemptStructured(
        deps,
        spec,
        input,
        a,
        a.route.provider === 'apple' && device ? device : cloud,
        schema,
      ),
  )
  if (key && deps.cache) deps.cache.set(key, value)
  return spec.finalize(value, input)
}

async function attemptStructured<I, L, O>(
  deps: RunnerDeps,
  spec: PromptSpec<I, L, O>,
  input: I,
  a: Attempt,
  built: BuiltPrompt,
  schema: JsonSchema,
): Promise<L> {
  const schemaMode = a.backend.supportsJsonSchema(a.route.model)
  const system = systemFor(built, schema, schemaMode)
  const first: ChatTurn[] = [{ role: 'user', content: built.user }]
  const outputCap =
    a.route.provider === 'apple'
      ? (spec.onDeviceMaxOutputTokens ?? spec.maxOutputTokens)
      : spec.maxOutputTokens
  const request = (messages: ChatTurn[], maxOutputTokens = outputCap) =>
    a.call({
      system,
      messages,
      output: { kind: 'json', name: spec.schemaName, schema: schemaMode ? schema : null },
      temperature: spec.temperature,
      maxOutputTokens,
      reasoningEffort: spec.reasoningEffort,
    })
  const started = deps.clock.now()
  let res: BackendResult = await request(first)
  let v = validate(spec.schema, res.text)
  const took = deps.clock.now() - started
  const timeLeft = () => a.deadline - deps.clock.now()

  if (!v.ok) {
    if (timeLeft() < took * 0.8) throw new InvalidOutputError(v.issues.join('; '))
    const truncated = res.finishReason === 'length'
    res = await request(
      [
        ...first,
        { role: 'assistant', content: res.text.slice(0, 8000) || '(empty)' },
        { role: 'user', content: repairMessage(v.issues) },
      ],
      truncated ? Math.round(outputCap * 1.5) : outputCap,
    )
    v = validate(spec.schema, res.text)
    if (!v.ok) throw new InvalidOutputError(v.issues.join('; '))
  }

  const soft = spec.check?.(v.value, input) ?? []
  if (soft.length > 0 && timeLeft() > took * 1.3) {
    try {
      const again = await request([
        ...first,
        { role: 'assistant', content: res.text.slice(0, 8000) },
        { role: 'user', content: softRepairMessage(soft) },
      ])
      const v2 = validate(spec.schema, again.text)
      if (v2.ok && (spec.check?.(v2.value, input).length ?? 0) < soft.length) return v2.value
    } catch {
      // keep the first valid answer
    }
  }
  return v.value
}
