import type { ModelRoute } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { FakeClock } from '../../clock'
import type { PromptSpec } from '../prompts/shared'
import { FakeBackend } from '../testing/fake-backend'
import { createMemoryCache } from './cache'
import { Router } from './router'
import { type RunnerDeps, runStructured } from './structured'

const Out = z.object({ answer: z.string().min(1), n: z.number().int() })
type Out = z.infer<typeof Out>

function spec(
  over: Partial<PromptSpec<string, Out, string>> = {},
): PromptSpec<string, Out, string> {
  return {
    id: 'T',
    task: 'testTask',
    version: 1,
    tier: 'reason',
    temperature: 0.2,
    maxOutputTokens: 400,
    reasoningEffort: 'low',
    schemaName: 'out',
    schema: Out,
    onDeviceOk: false,
    cacheable: true,
    language: () => 'en',
    build: (input, ctx) => ({ system: ctx.onDevice ? 'COMPACT' : 'FULL', user: `q: ${input}` }),
    finalize: (o) => `${o.answer}#${o.n}`,
    ...over,
  }
}

const GROQ: ModelRoute = { provider: 'groq', model: 'g' }
const OVH: ModelRoute = { provider: 'ovh', model: 'o' }
const APPLE: ModelRoute = { provider: 'apple', model: 'system' }

function setup(routes: ModelRoute[] = [GROQ, OVH]) {
  const clock = new FakeClock()
  const groq = new FakeBackend('groq')
  const ovh = new FakeBackend('ovh')
  const apple = new FakeBackend('apple')
  const router = new Router({ backends: { groq, ovh, apple }, clock, routes: () => routes })
  const deps: RunnerDeps = {
    router,
    cache: createMemoryCache(clock),
    clock,
    today: () => '2026-10-24 (Saturday)',
  }
  return { clock, groq, ovh, apple, deps }
}

describe('runStructured', () => {
  it('uses JSON-schema mode when the model supports it', async () => {
    const t = setup()
    t.groq.queue({ json: { answer: 'a', n: 1 } })
    expect(await runStructured(t.deps, spec(), 'x')).toBe('a#1')
    const req = t.groq.requests[0]
    expect(req?.output).toMatchObject({ kind: 'json', name: 'out' })
    expect(req?.output.kind === 'json' && req.output.schema).toBeTruthy()
    expect(req?.system).not.toContain('JSON Schema')
    expect(req?.reasoningEffort).toBe('low')
  })

  it('falls back to JSON mode with the schema in the instructions', async () => {
    const t = setup()
    t.groq.jsonSchema = false
    t.groq.queue({ json: { answer: 'b', n: 2 } })
    expect(await runStructured(t.deps, spec(), 'x')).toBe('b#2')
    const req = t.groq.requests[0]
    expect(req?.output.kind === 'json' && req.output.schema).toBeNull()
    expect(req?.system).toContain('JSON Schema')
    expect(req?.system).toContain('"answer"')
  })

  it('repairs once with the validation errors', async () => {
    const t = setup()
    t.groq.queue({ json: { answer: '', n: 1.5 } }, { json: { answer: 'fixed', n: 2 } })
    expect(await runStructured(t.deps, spec(), 'x')).toBe('fixed#2')
    const repair = t.groq.requests[1]
    expect(repair?.messages).toHaveLength(3)
    expect(repair?.messages[1]?.role).toBe('assistant')
    expect(repair?.messages[2]?.content).toMatch(/did not pass validation/)
    expect(repair?.messages[2]?.content).toMatch(/answer:/)
    expect(repair?.messages[2]?.content).toMatch(/n:/)
  })

  it('gives a truncated answer more room in the repair', async () => {
    const t = setup()
    t.groq.queue(
      { text: '{"answer": "lo', finishReason: 'length' },
      { json: { answer: 'long', n: 3 } },
    )
    expect(await runStructured(t.deps, spec(), 'x')).toBe('long#3')
    expect(t.groq.requests[1]?.maxOutputTokens).toBe(600)
  })

  it('moves to the next route when the repair fails too', async () => {
    const t = setup()
    t.groq.queue({ text: 'not json' }, { text: 'still not json' })
    t.ovh.queue({ json: { answer: 'ovh', n: 4 } })
    expect(await runStructured(t.deps, spec(), 'x')).toBe('ovh#4')
    expect(t.groq.requests).toHaveLength(2)
  })

  it('soft-repairs rule violations and keeps the better answer', async () => {
    const t = setup()
    const check = (o: Out) => (o.n > 10 ? ['n must be at most 10'] : [])
    t.groq.queue({ json: { answer: 'first', n: 50 } }, { json: { answer: 'second', n: 5 } })
    expect(await runStructured(t.deps, spec({ check }), 'x')).toBe('second#5')
    expect(t.groq.requests[1]?.messages[2]?.content).toMatch(/n must be at most 10/)

    t.groq.queue({ json: { answer: 'first', n: 50 } }, { json: { answer: 'worse', n: 99 } })
    expect(await runStructured(t.deps, spec({ check, cacheable: false }), 'y')).toBe('first#50')
  })

  it('caches validated answers for 24 h, unless the spec or caller opts out', async () => {
    const t = setup()
    t.groq.fallback = { json: { answer: 'c', n: 1 } }
    await runStructured(t.deps, spec(), 'same')
    await runStructured(t.deps, spec(), 'same')
    expect(t.groq.requests).toHaveLength(1)
    await runStructured(t.deps, spec(), 'same', { noCache: true })
    expect(t.groq.requests).toHaveLength(2)
    await runStructured(t.deps, spec({ cacheable: false }), 'same')
    expect(t.groq.requests).toHaveLength(3)
    await runStructured(t.deps, spec({ version: 2 }), 'same') // prompt change invalidates
    expect(t.groq.requests).toHaveLength(4)
    t.clock.advance(25 * 3_600_000)
    await runStructured(t.deps, spec(), 'same')
    expect(t.groq.requests).toHaveLength(5)
  })

  it('sends the compact variant to the on-device model', async () => {
    const t = setup([APPLE, OVH])
    t.apple.queue({ json: { answer: 'local', n: 1 } })
    expect(await runStructured(t.deps, spec({ onDeviceOk: true }), 'x')).toBe('local#1')
    expect(t.apple.requests[0]?.system.startsWith('COMPACT')).toBe(true)
    t.ovh.queue({ json: { answer: 'cloud', n: 1 } })
    expect(await runStructured(t.deps, spec({ onDeviceOk: false }), 'z')).toBe('cloud#1')
    expect(t.ovh.requests[0]?.system.startsWith('FULL')).toBe(true)
  })
})
