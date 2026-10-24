/**
 * JSON plumbing for structured output: zod → a JSON Schema that strict providers accept
 * (Groq/OVHcloud strict mode, Apple guided generation), lenient parsing of model text, and
 * compact validation-error summaries for the repair call.
 */
import { type ZodType, z } from 'zod'
import type { JsonSchema } from './types'

const DROP_KEYS = new Set([
  '$schema',
  '$id',
  'default',
  'format',
  'pattern',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'uniqueItems',
  'minProperties',
  'maxProperties',
])

function sanitize(node: unknown): unknown {
  if (Array.isArray(node)) return node.map(sanitize)
  if (!node || typeof node !== 'object') return node
  const src = node as Record<string, unknown>
  const out: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(src)) {
    if (DROP_KEYS.has(key)) continue
    if (key === 'oneOf') {
      out.anyOf = sanitize(value)
      continue
    }
    if (key === 'const') {
      out.enum = [value]
      if (typeof value === 'string' && !('type' in src)) out.type = 'string'
      continue
    }
    out[key] = sanitize(value)
  }
  if (out.type === 'object' && out.properties && typeof out.properties === 'object') {
    out.required = Object.keys(out.properties as object)
    out.additionalProperties = false
  }
  return out
}

/** Strict-mode-safe JSON Schema for a zod schema (constraints stay enforced locally by zod). */
export function toProviderSchema(schema: ZodType): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: 'draft-7', io: 'output', unrepresentable: 'any' })
  return sanitize(raw) as JsonSchema
}

export type ParseResult = { ok: true; value: unknown } | { ok: false; error: string }

function stripFences(text: string): string {
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text)
  return fenced?.[1] ? fenced[1].trim() : text.trim()
}

/** Parses model output that should be JSON but may carry fences or chatter around it. */
export function parseJsonLenient(text: string): ParseResult {
  const body = stripFences(text)
  if (!body) return { ok: false, error: 'empty response' }
  try {
    return { ok: true, value: JSON.parse(body) }
  } catch {
    // fall through to substring search
  }
  const starts = [body.indexOf('{'), body.indexOf('[')].filter((i) => i >= 0)
  if (starts.length === 0) return { ok: false, error: 'no JSON object found' }
  const start = Math.min(...starts)
  const closer = body[start] === '{' ? '}' : ']'
  const end = body.lastIndexOf(closer)
  if (end > start) {
    try {
      return { ok: true, value: JSON.parse(body.slice(start, end + 1)) }
    } catch (err) {
      return { ok: false, error: `invalid JSON: ${(err as Error).message}` }
    }
  }
  return { ok: false, error: 'truncated JSON (no closing bracket)' }
}

/** "items.2.options: Too small: expected array to have >=4 items" lines, at most `max`. */
export function summarizeIssues(error: z.ZodError, max = 12): string[] {
  const lines = error.issues.slice(0, max).map((i) => {
    const path = i.path.length ? i.path.join('.') : '(root)'
    return `${path}: ${i.message}`
  })
  if (error.issues.length > max) lines.push(`…and ${error.issues.length - max} more`)
  return lines
}
