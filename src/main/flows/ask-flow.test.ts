/**
 * Ask flow: thread 'ask' bookkeeping, the context window (last 10 messages after the latest
 * "New chat"), streaming via `emitDelta`, and pasting a prompt when an AI chat is open.
 */
import type { Brain, CoachEvent, CoachInput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import { describe, expect, it, vi } from 'vitest'
import { AskFlow, type AskFlowDeps, afterReset } from './ask-flow'

const T0 = Date.parse('2026-10-24T10:00:00.000Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()

interface Setup {
  reply?: string[]
  actions?: CoachAction[]
  aiChat?: boolean
  stream?: boolean
  fail?: boolean
}

function setup(opts: Setup = {}) {
  const messages: ChatMessage[] = []
  let now = 0
  const chat = {
    append(input: Omit<ChatMessage, 'id' | 'createdAt'>): ChatMessage {
      now += 10
      const message = { ...input, id: `msg_${messages.length + 1}`, createdAt: at(now) }
      messages.push(message)
      return message
    },
    history: (thread: string, limit: number) =>
      messages.filter((m) => m.thread === thread).slice(-limit),
  }
  const inputs: CoachInput[] = []
  const brain = {
    coach(input: CoachInput): AsyncIterable<CoachEvent> {
      inputs.push(input)
      return (async function* () {
        for (const delta of opts.reply ?? ['Hello ', 'there.']) yield { type: 'text', delta }
        if (opts.fail) throw new Error('Groq is busy')
        for (const action of opts.actions ?? []) yield { type: 'action', action }
        yield { type: 'done' }
      })()
    },
  }
  const deltas: EventPayload<'chat.delta'>[] = []
  const writer = { write: vi.fn(async () => ({ ok: true, reason: null })) }
  const toasts = { showToast: vi.fn(() => 'toast_1') }
  const deps = {
    brain: brain as unknown as Brain,
    repos: { chat, profile: { get: () => ({ summary: 'A student' }) } } as unknown as Repos,
    perception: { aiChat: () => (opts.aiChat ? { assistant: 'ChatGPT' } : null) },
    sessions: { start: vi.fn(async () => ({ write: { ok: true } })) },
    writer,
    thinking: { run: (_label: string, fn: () => Promise<unknown>) => fn() },
    overlay: toasts,
    contextText: () => 'Studying chemistry',
    runAction: vi.fn(async () => undefined),
    emitDelta:
      opts.stream === false ? undefined : (d: EventPayload<'chat.delta'>) => deltas.push(d),
  } as unknown as AskFlowDeps
  const seed = (n: number) => {
    for (let i = 0; i < n; i++) {
      chat.append({
        thread: 'ask',
        role: i % 2 ? 'assistant' : 'user',
        content: `old ${i + 1}`,
        actions: [],
      })
    }
  }
  return { flow: new AskFlow(deps), messages, inputs, deltas, writer, toasts, seed, at: () => now }
}

const history = (input: CoachInput | undefined) => input?.history.map((m) => m.content)

describe('AskFlow.submit', () => {
  it('stores both turns in thread ask and streams the reply on it', async () => {
    const s = setup()
    const result = await s.flow.submit('What is a mole?')
    expect(result).toEqual({ reply: 'Hello there.', actions: [], pasted: false })
    expect(s.messages.map((m) => [m.thread, m.role, m.content])).toEqual([
      ['ask', 'user', 'What is a mole?'],
      ['ask', 'assistant', 'Hello there.'],
    ])
    expect(s.deltas).toEqual([
      { thread: 'ask', messageId: 'ask_pending_1', delta: 'Hello ', done: false },
      { thread: 'ask', messageId: 'ask_pending_1', delta: 'there.', done: false },
      { thread: 'ask', messageId: 'ask_pending_1', delta: '', done: true },
    ])
    await s.flow.submit('And a molar mass?')
    expect(s.deltas.at(-1)?.messageId).toBe('ask_pending_2')
  })

  it('sends the last 10 messages of the thread as context', async () => {
    const s = setup()
    s.seed(12)
    await s.flow.submit('Next question')
    expect(history(s.inputs[0])).toEqual(Array.from({ length: 10 }, (_, i) => `old ${i + 3}`))
    expect(s.inputs[0]?.message).toBe('Next question')
  })

  it('leaves messages from before "New chat" out of the context', async () => {
    const s = setup()
    s.seed(4) // created at +10 … +40 s
    await s.flow.submit('Fresh start', { since: at(25) })
    expect(history(s.inputs[0])).toEqual(['old 3', 'old 4'])

    await s.flow.submit('Right after a reset', { since: at(s.at() + 1) })
    expect(history(s.inputs[1])).toEqual([])

    // Later turns (and `/d` instructions, which share the thread) keep the latest reset.
    await s.flow.submit('Follow-up')
    expect(history(s.inputs[2])).toEqual(['Right after a reset', 'Hello there.'])
    await s.flow.instruction('make it simpler')
    expect(history(s.inputs[3])).toEqual([
      'Right after a reset',
      'Hello there.',
      'Follow-up',
      'Hello there.',
    ])
  })

  it('ignores an older or malformed since', async () => {
    const s = setup()
    s.seed(4)
    await s.flow.submit('one', { since: at(25) })
    await s.flow.submit('two', { since: at(5) })
    await s.flow.submit('three', { since: 'not a date' })
    expect(history(s.inputs[1])?.[0]).toBe('old 3')
    expect(history(s.inputs[2])?.[0]).toBe('old 3')
  })

  it('works without a delta sink', async () => {
    const s = setup({ stream: false })
    expect((await s.flow.submit('hi')).reply).toBe('Hello there.')
    expect(s.deltas).toEqual([])
  })

  it('ends the stream when the brain fails', async () => {
    const s = setup({ fail: true })
    await expect(s.flow.submit('hi')).rejects.toThrow('Groq is busy')
    expect(s.deltas.at(-1)).toEqual({
      thread: 'ask',
      messageId: 'ask_pending_1',
      delta: '',
      done: true,
    })
  })

  it('pastes an insert_prompt into an open AI chat and keeps the rest as chips', async () => {
    const exam: CoachAction = {
      type: 'create_exam',
      spec: { subjectIds: ['s'], count: 5, focus: 'weak', difficulty: 'mixed' },
    }
    const s = setup({
      aiChat: true,
      actions: [{ type: 'insert_prompt', text: 'Explain moles simply' }, exam],
    })
    const result = await s.flow.submit('moles?')
    expect(s.writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Explain moles simply', mode: 'insert', target: 'chat' }),
    )
    expect(result).toEqual({ reply: 'Hello there.', actions: [exam], pasted: true })
    expect(s.messages.at(-1)?.actions).toEqual([exam])
    expect(s.toasts.showToast).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'tip', body: 'Hello there.' }),
    )
  })

  it('without an AI chat every action comes back as a chip', async () => {
    const prompt: CoachAction = { type: 'insert_prompt', text: 'Explain moles simply' }
    const s = setup({ actions: [prompt] })
    const result = await s.flow.submit('moles?')
    expect(s.writer.write).not.toHaveBeenCalled()
    expect(result).toEqual({ reply: 'Hello there.', actions: [prompt], pasted: false })
  })
})

describe('afterReset', () => {
  const msg = (seconds: number): ChatMessage => ({
    id: `m${seconds}`,
    thread: 'ask',
    role: 'user',
    content: String(seconds),
    actions: [],
    createdAt: at(seconds),
  })

  it('keeps everything without a reset and only newer messages after one', () => {
    const all = [msg(1), msg(2), msg(3)]
    expect(afterReset(all, null)).toBe(all)
    expect(afterReset(all, Date.parse(at(2))).map((m) => m.id)).toEqual(['m3'])
  })
})
