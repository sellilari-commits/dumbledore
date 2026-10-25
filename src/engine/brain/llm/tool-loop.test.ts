import { BrainTimeoutError } from '@engine/brain-contract'
import { describe, expect, it } from 'vitest'
import { FakeClock } from '../../clock'
import {
  clipResult,
  runToolLoop,
  stableJson,
  TOOL_LOOP_LINES_EN,
  TOOL_RESULTS_HEADER,
  type ToolLoopEvent,
  type ToolLoopOptions,
  type ToolStepContext,
} from './tool-loop'
import type { ChatTurn, StreamPart, ToolDef } from './types'

const TOOLS: ToolDef[] = [
  { name: 'read', description: 'read records', parameters: { type: 'object' } },
  { name: 'update', description: 'edit a record', parameters: { type: 'object' } },
]

type Script = { text?: string[]; calls?: { name: string; input: unknown }[] } | Error | 'hang'

interface StepLog {
  messages: ChatTurn[]
  tools: ToolDef[] | undefined
  ctx: ToolStepContext
}

/** A fake `step`: one scripted reply per call, recording what each call received. */
function scripted(...scripts: Script[]) {
  const log: StepLog[] = []
  const step = (messages: ChatTurn[], tools: ToolDef[] | undefined, ctx: ToolStepContext) => {
    log.push({ messages: [...messages], tools, ctx })
    const s = scripts.shift()
    return (async function* (): AsyncGenerator<StreamPart> {
      if (!s) throw new Error('no step scripted')
      if (s instanceof Error) throw s
      if (s === 'hang') {
        await new Promise(() => {})
        return
      }
      for (const delta of s.text ?? []) yield { type: 'text', delta }
      for (const call of s.calls ?? []) yield { type: 'tool-call', call }
      yield { type: 'finish', usage: { inputTokens: 1, outputTokens: 1 }, headers: {} }
    })()
  }
  return { step, log }
}

function runner(results: Record<string, unknown> = {}) {
  const calls: { name: string; input: unknown }[] = []
  const run = async (name: string, input: unknown) => {
    calls.push({ name, input })
    return { ok: name in results, result: results[name] ?? { error: 'unknown tool' } }
  }
  return { run, calls }
}

async function collect(it: AsyncIterable<ToolLoopEvent>): Promise<ToolLoopEvent[]> {
  const out: ToolLoopEvent[] = []
  for await (const e of it) out.push(e)
  return out
}

const textOf = (events: ToolLoopEvent[]) =>
  events.map((e) => (e.type === 'text' ? e.delta : '')).join('')
const doneOf = (events: ToolLoopEvent[]) => events.find((e) => e.type === 'done')

function loop(
  step: ToolLoopOptions['step'],
  run: ToolLoopOptions['run'],
  more: Partial<ToolLoopOptions> = {},
) {
  return runToolLoop({
    messages: [{ role: 'user', content: 'what are the steps of my chemistry roadmap?' }],
    tools: TOOLS,
    step,
    run,
    clock: new FakeClock(),
    ...more,
  })
}

describe('runToolLoop', () => {
  it('reads, sees the result, then answers', async () => {
    const { step, log } = scripted(
      { text: ['Let me look.'], calls: [{ name: 'read', input: { kind: 'roadmap', id: 'rm_1' } }] },
      { text: ['1. Carbocations (done)', '\n2. SN1 (current)'] },
    )
    const r = runner({ read: { steps: ['Carbocations', 'SN1'] } })
    const events = await collect(loop(step, r.run))

    expect(r.calls).toEqual([{ name: 'read', input: { kind: 'roadmap', id: 'rm_1' } }])
    expect(textOf(events)).toBe('Let me look.\n\n1. Carbocations (done)\n2. SN1 (current)')
    expect(events.filter((e) => e.type !== 'text').map((e) => e.type)).toEqual([
      'tool-call',
      'tool-result',
      'done',
    ])
    expect(doneOf(events)).toEqual({ type: 'done', reason: 'answered', steps: 2, toolCalls: 1 })
    expect(log[0]?.tools).toBe(TOOLS)
    expect(log[1]?.tools).toBe(TOOLS)
  })

  it('feeds the calls and results back as an assistant turn and a marked user turn', async () => {
    const { step, log } = scripted(
      { text: ['Checking.'], calls: [{ name: 'read', input: { id: 'rm_1', kind: 'roadmap' } }] },
      { text: ['Done.'] },
    )
    await collect(loop(step, runner({ read: { title: 'Organic chemistry' } }).run))

    const second = log[1]?.messages ?? []
    expect(second.map((m) => m.role)).toEqual(['user', 'assistant', 'user'])
    expect(second[1]?.content).toBe('Checking.\n[tool calls]\nread {"id":"rm_1","kind":"roadmap"}')
    const results = second[2]?.content ?? ''
    expect(results.startsWith(TOOL_RESULTS_HEADER)).toBe(true)
    expect(results).toContain('1. read {"id":"rm_1","kind":"roadmap"} → ok')
    expect(results).toContain('{"title":"Organic chemistry"}')
    expect(results).toMatch(/otherwise answer the student now/)
  })

  it('writes, then answers; a failed call goes back as failed', async () => {
    const { step, log } = scripted(
      {
        calls: [
          { name: 'update', input: { kind: 'subject', id: 'sub_1', patch: { goal: 'pass' } } },
          { name: 'nope', input: {} },
        ],
      },
      { text: ['Saved your goal.'] },
    )
    const r = runner({ update: { updated: 'sub_1' } })
    const events = await collect(loop(step, r.run))

    expect(r.calls.map((c) => c.name)).toEqual(['update', 'nope'])
    const results = events.flatMap((e) => (e.type === 'tool-result' ? [[e.name, e.ok]] : []))
    expect(results).toEqual([
      ['update', true],
      ['nope', false],
    ])
    expect(log[1]?.messages.at(-1)?.content).toContain('2. nope {} → failed')
    expect(textOf(events)).toBe('Saved your goal.')
  })

  it('runs the last allowed step without tools so it has to answer', async () => {
    const { step, log } = scripted(
      { calls: [{ name: 'read', input: { kind: 'subject' } }] },
      { calls: [{ name: 'read', input: { kind: 'roadmap' } }] },
      { text: ['Here is what I found.'], calls: [{ name: 'read', input: { kind: 'note' } }] },
    )
    const r = runner({ read: [] })
    const events = await collect(loop(step, r.run, { maxSteps: 3 }))

    expect(log.map((l) => l.tools === undefined)).toEqual([false, false, true])
    expect(log.map((l) => l.ctx.final)).toEqual([false, false, true])
    expect(r.calls).toHaveLength(2) // the final step's call is ignored
    expect(log[2]?.messages.at(-1)?.content).toMatch(/No more tool calls.*Answer the student now/)
    expect(textOf(events)).toBe('Here is what I found.')
    expect(doneOf(events)).toMatchObject({ reason: 'max-steps', steps: 3, toolCalls: 2 })
  })

  it('does not run a repeated identical call again and makes the model answer', async () => {
    const { step, log } = scripted(
      { calls: [{ name: 'read', input: { kind: 'roadmap', id: 'rm_1' } }] },
      { calls: [{ name: 'read', input: { id: 'rm_1', kind: 'roadmap' } }] },
      { text: ['Your roadmap has two steps.'] },
    )
    const r = runner({ read: { steps: 2 } })
    const events = await collect(loop(step, r.run))

    expect(r.calls).toHaveLength(1)
    const repeated = events.filter((e) => e.type === 'tool-result' && e.repeated)
    expect(repeated).toHaveLength(1)
    expect(repeated[0]).toMatchObject({ ok: true, result: { steps: 2 } })
    expect(log[2]?.messages.at(-1)?.content).toMatch(/already made this exact call/)
    expect(log[2]?.tools).toBeUndefined()
    expect(doneOf(events)).toMatchObject({ reason: 'repeat', steps: 3, toolCalls: 1 })
  })

  it('throws a timeout when the deadline passes before any tool ran', async () => {
    const clock = new FakeClock()
    const { step } = scripted('hang')
    const it = loop(step, runner().run, { clock, timeoutMs: 10_000, task: 'coach' })
    const pending = collect(it)
    await Promise.resolve()
    clock.advance(10_000)
    await expect(pending).rejects.toBeInstanceOf(BrainTimeoutError)
  })

  it('on the deadline after a tool ran, ends with a short line instead of throwing', async () => {
    const clock = new FakeClock()
    const { step, log } = scripted(
      { calls: [{ name: 'update', input: { kind: 'note', id: 'n_1' } }] },
      'hang',
    )
    const r = runner({ update: { ok: true } })
    const pending = collect(loop(step, r.run, { clock, timeoutMs: 30_000 }))
    for (let i = 0; i < 20 && log.length < 2; i++) await new Promise((res) => setTimeout(res, 0))
    expect(log[1]?.ctx.deadline).toBe(clock.now() + 30_000)
    clock.advance(30_000)
    const events = await pending
    expect(r.calls).toHaveLength(1)
    expect(textOf(events)).toBe(TOOL_LOOP_LINES_EN.cutShort)
    expect(doneOf(events)).toMatchObject({ reason: 'deadline', toolCalls: 1 })
  })

  it('stops on abort: throws before any tool, ends quietly after one', async () => {
    const before = new AbortController()
    before.abort()
    await expect(
      collect(loop(scripted({ text: ['hi'] }).step, runner().run, { signal: before.signal })),
    ).rejects.toMatchObject({ name: 'AbortError' })

    const after = new AbortController()
    const { step, log } = scripted({ calls: [{ name: 'read', input: {} }] }, 'hang')
    const pending = collect(loop(step, runner({ read: 1 }).run, { signal: after.signal }))
    for (let i = 0; i < 20 && log.length < 2; i++) await new Promise((res) => setTimeout(res, 0))
    expect(log[1]?.ctx.signal.aborted).toBe(false)
    after.abort()
    const events = await pending
    expect(log[1]?.ctx.signal.aborted).toBe(true)
    expect(textOf(events)).toBe('')
    expect(doneOf(events)).toMatchObject({ reason: 'aborted', toolCalls: 1 })
  })

  it('an error after a tool ran still ends the turn with text; before, it is thrown', async () => {
    const { step } = scripted(
      { text: ['Renaming it.'], calls: [{ name: 'update', input: { id: 's_1' } }] },
      new Error('provider down'),
    )
    const events = await collect(loop(step, runner({ update: { renamed: true } }).run))
    expect(textOf(events)).toBe(`Renaming it.\n\n${TOOL_LOOP_LINES_EN.cutShort}`)
    expect(doneOf(events)).toMatchObject({ reason: 'error', toolCalls: 1 })

    await expect(
      collect(loop(scripted(new Error('provider down')).step, runner().run)),
    ).rejects.toThrow('provider down')
  })

  it('a throwing run() counts as a failed call', async () => {
    const { step, log } = scripted(
      { calls: [{ name: 'read', input: {} }] },
      { text: ['Could not read it.'] },
    )
    const run = async () => {
      throw new Error('db locked')
    }
    const events = await collect(loop(step, run))
    expect(events.find((e) => e.type === 'tool-result')).toMatchObject({
      ok: false,
      result: { error: 'db locked' },
    })
    expect(log[1]?.messages.at(-1)?.content).toContain('db locked')
  })

  it('clips long results before they reach the model', async () => {
    const big = { items: Array.from({ length: 500 }, (_, i) => `item number ${i}`) }
    const { step, log } = scripted(
      { calls: [{ name: 'read', input: { kind: 'note' } }] },
      { text: ['ok'] },
    )
    const events = await collect(loop(step, runner({ read: big }).run, { clipChars: 1000 }))
    const turn = log[1]?.messages.at(-1)?.content ?? ''
    expect(turn.length).toBeLessThan(1400)
    expect(turn).toMatch(/\[cut \d+ more characters/)
    // The caller still gets the whole result.
    expect(events.find((e) => e.type === 'tool-result')).toMatchObject({ result: big })
  })

  it('says something when the model never writes text', async () => {
    const { step } = scripted({})
    const events = await collect(loop(step, runner().run))
    expect(textOf(events)).toBe(TOOL_LOOP_LINES_EN.noAnswer)
  })
})

describe('tool-loop helpers', () => {
  it('stableJson sorts keys; clipResult keeps short JSON as is', () => {
    expect(stableJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 0 }] } })).toBe(
      '{"a":{"c":[3,{"e":0,"f":1}],"d":2},"b":1}',
    )
    expect(stableJson(undefined)).toBe('null')
    expect(clipResult({ a: 1 })).toBe('{"a":1}')
    expect(clipResult(undefined)).toBe('null')
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(clipResult(cyclic)).toBe('{"self":"[circular]"}')
  })
})
