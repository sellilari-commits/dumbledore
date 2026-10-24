import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { parseJsonLenient, summarizeIssues, toProviderSchema } from './json'

describe('toProviderSchema', () => {
  it('makes every property required, closes objects and drops unsupported keywords', () => {
    const schema = z.object({
      name: z.string().min(1).max(10),
      tags: z.array(z.string()).max(3),
      note: z.string().nullable(),
      nested: z.object({ n: z.number().int().min(0) }),
    })
    const js = toProviderSchema(schema) as Record<string, unknown>
    expect(js.$schema).toBeUndefined()
    expect(js.required).toEqual(['name', 'tags', 'note', 'nested'])
    expect(js.additionalProperties).toBe(false)
    const text = JSON.stringify(js)
    for (const k of ['minLength', 'maxLength', 'maxItems', 'minimum']) expect(text).not.toContain(k)
    const nested = (js.properties as Record<string, Record<string, unknown>>).nested
    expect(nested?.additionalProperties).toBe(false)
  })

  it('turns oneOf into anyOf and const into enum', () => {
    const schema = z.object({
      item: z.discriminatedUnion('kind', [
        z.object({ kind: z.literal('a'), x: z.string() }),
        z.object({ kind: z.literal('b'), y: z.number() }),
      ]),
    })
    const text = JSON.stringify(toProviderSchema(schema))
    expect(text).not.toContain('oneOf')
    expect(text).not.toContain('"const"')
    expect(text).toContain('"enum":["a"]')
  })
})

describe('parseJsonLenient', () => {
  it('parses plain, fenced and chatty JSON', () => {
    expect(parseJsonLenient('{"a":1}')).toEqual({ ok: true, value: { a: 1 } })
    expect(parseJsonLenient('```json\n{"a":2}\n```')).toEqual({ ok: true, value: { a: 2 } })
    expect(parseJsonLenient('Sure! Here it is: {"a":3} Hope this helps')).toEqual({
      ok: true,
      value: { a: 3 },
    })
  })

  it('reports empty and truncated output', () => {
    expect(parseJsonLenient('').ok).toBe(false)
    const r = parseJsonLenient('{"a": [1, 2')
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.error).toMatch(/truncated|invalid/)
  })
})

describe('summarizeIssues', () => {
  it('formats paths and caps the list', () => {
    const r = z.object({ xs: z.array(z.number()) }).safeParse({ xs: ['a', 'b', 'c'] })
    expect(r.success).toBe(false)
    if (r.success) return
    const lines = summarizeIssues(r.error, 2)
    expect(lines[0]).toMatch(/^xs\.0: /)
    expect(lines).toHaveLength(3)
    expect(lines[2]).toMatch(/1 more/)
  })
})
