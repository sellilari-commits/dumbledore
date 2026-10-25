import type { CoachEvent, CoachInput, CoachTools } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { BackendError } from './llm/types'
import { brainHarness, R } from './testing/harness'

const input = (message: string): CoachInput => ({
  profile: 'First-year chemistry student',
  context: 'Subjects: Organic Chemistry (id sub_1); roadmap rm_1 "Reactions", step 2 of 4',
  history: [],
  message,
})

function shellTools(results: Record<string, unknown> = {}) {
  const calls: { name: string; input: unknown }[] = []
  const tools: CoachTools = {
    specs: [
      {
        name: 'read',
        description: 'Read any record by kind and id.',
        parameters: { type: 'object', properties: { kind: { type: 'string' } } },
      },
      {
        name: 'act',
        description: 'Run a flow: start_roadmap, … and app actions.',
        parameters: { type: 'object', properties: { name: { type: 'string' } } },
      },
    ],
    async run(name, input) {
      calls.push({ name, input })
      return name in results
        ? { ok: true, result: results[name] }
        : { ok: false, result: { error: 'unknown tool' } }
    },
  }
  return { tools, calls }
}

async function collect(it: AsyncIterable<CoachEvent>): Promise<CoachEvent[]> {
  const out: CoachEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

/** Brain.coachLoop, which the real brain always has. */
function loopOf(h: ReturnType<typeof brainHarness>) {
  const loop = h.brain.coachLoop
  if (!loop) throw new Error('coachLoop missing')
  return loop
}

const textOf = (events: CoachEvent[]) =>
  events.map((e) => (e.type === 'text' ? e.delta : '')).join('')

describe('Brain.coachLoop', () => {
  it('runs a tool, feeds the result back and streams the answer', async () => {
    const h = brainHarness([R.gemini, R.groq])
    h.gemini.queue(
      { toolCalls: [{ name: 'read', input: { kind: 'roadmap', id: 'rm_1' } }] },
      { chunks: ['1. Carbocations (done)', '\n2. SN1 (current)'] },
    )
    const { tools, calls } = shellTools({ read: { steps: ['Carbocations', 'SN1'] } })
    const events = await collect(loopOf(h)(input('what are the steps?'), tools))

    expect(calls).toEqual([{ name: 'read', input: { kind: 'roadmap', id: 'rm_1' } }])
    expect(events[0]).toEqual({
      type: 'tool',
      name: 'read',
      input: { kind: 'roadmap', id: 'rm_1' },
      ok: true,
    })
    expect(textOf(events)).toBe('1. Carbocations (done)\n2. SN1 (current)')
    expect(events.at(-1)).toEqual({ type: 'done' })
    expect(events.some((e) => e.type === 'action')).toBe(false)

    const [first, second] = h.gemini.requests
    expect(first?.tools?.map((t) => t.name)).toEqual(['read', 'act'])
    expect(first?.output).toEqual({ kind: 'text' })
    expect(first?.system).toContain('sub_1')
    expect(first?.system).toMatch(/read, search, create, update, delete and act/)
    expect(second?.messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second?.messages.at(-1)?.content).toContain('"steps":["Carbocations","SN1"]')
    expect(h.groq.requests).toHaveLength(0)
  })

  it('falls through to the next chat model before the first part of a step', async () => {
    const h = brainHarness([R.gemini, R.groq])
    h.gemini.queue({ error: new BackendError('rate_limit', 'busy', { status: 429 }) })
    h.groq.queue({ text: 'Focus on carbocations first.' })
    const events = await collect(loopOf(h)(input('what should I focus on?'), shellTools().tools))
    expect(textOf(events)).toBe('Focus on carbocations first.')
  })

  it('answers without tools on the last allowed step', async () => {
    const h = brainHarness([R.groq])
    h.groq.queue(
      { toolCalls: [{ name: 'read', input: { kind: 'subject' } }] },
      { text: 'You have one subject.' },
    )
    const { tools } = shellTools({ read: [{ id: 'sub_1' }] })
    const events = await collect(loopOf(h)(input('what do I study?'), tools, { maxSteps: 2 }))
    // The last step lists the tools but may not call them (toolChoice 'none').
    expect(h.groq.requests.map((r) => r.toolChoice)).toEqual(['auto', 'none'])
    expect(h.groq.requests[1]?.tools?.map((t) => t.name)).toEqual(['read', 'act'])
    expect(textOf(events)).toBe('You have one subject.')
  })

  it('keeps the turn when a later step fails after a write, in the student’s language', async () => {
    const h = brainHarness([R.groq])
    h.groq.queue(
      { toolCalls: [{ name: 'act', input: { name: 'add_note', args: { text: 'SN1' } } }] },
      { error: new BackendError('server', 'boom', { status: 500 }) },
    )
    const { tools, calls } = shellTools({ act: { saved: true } })
    const events = await collect(
      loopOf(h)(input('muista että SN1 on kaksivaiheinen reaktio ja se on tärkeä'), tools),
    )
    expect(calls).toHaveLength(1)
    expect(events.find((e) => e.type === 'tool')).toMatchObject({ name: 'act', ok: true })
    expect(textOf(events)).toMatch(/^Anteeksi, en saanut tätä valmiiksi/)
    expect(events.at(-1)).toEqual({ type: 'done' })
  })

  it('validates its input like coach()', () => {
    const h = brainHarness()
    expect(() =>
      loopOf(h)({ message: 'hi' } as unknown as CoachInput, shellTools().tools),
    ).toThrow()
  })
})
