/**
 * Ask flow: thread 'ask' bookkeeping, the context window (last 10 messages after the latest
 * "New chat"), streaming via `emitDelta`, and pasting a prompt when an AI chat is open.
 */
import type { Brain, CoachEvent, CoachInput } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { ChatMessage, CoachAction } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import { describe, expect, it, vi } from 'vitest'
import { AskFlow, type AskFlowDeps, afterReset, topicContext } from './ask-flow'

const T0 = Date.parse('2026-10-24T10:00:00.000Z')
const at = (seconds: number) => new Date(T0 + seconds * 1000).toISOString()

interface Setup {
  reply?: string[]
  actions?: CoachAction[]
  aiChat?: boolean
  stream?: boolean
  fail?: boolean
  feedback?: boolean
  saves?: boolean
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
  const feedback = { add: vi.fn() }
  const saves = {
    apply: vi.fn((a: CoachAction) =>
      a.type === 'add_note' || a.type === 'save_question'
        ? {
            line: `Saved to Chemistry: “${a.text}”`,
            undo: { type: 'undo_save' as const, saveId: `s_${a.type}` },
            more: [],
          }
        : null,
    ),
  }
  const deps = {
    brain: brain as unknown as Brain,
    repos: {
      chat,
      profile: { get: () => ({ summary: 'A student' }) },
      ...TOPIC_REPOS,
    } as unknown as Repos,
    perception: { aiChat: () => (opts.aiChat ? { assistant: 'ChatGPT' } : null) },
    sessions: { start: vi.fn(async () => ({ write: { ok: true } })) },
    writer,
    thinking: { run: (_label: string, fn: () => Promise<unknown>) => fn() },
    overlay: toasts,
    contextText: () => 'Studying chemistry',
    runAction: vi.fn(async () => undefined),
    emitDelta:
      opts.stream === false ? undefined : (d: EventPayload<'chat.delta'>) => deltas.push(d),
    ...(opts.feedback ? { feedback } : {}),
    ...(opts.saves ? { saves } : {}),
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
  const sessions = deps.sessions
  return {
    flow: new AskFlow(deps),
    messages,
    inputs,
    deltas,
    writer,
    toasts,
    sessions,
    seed,
    feedback,
    at: () => now,
  }
}

const CHEM = {
  id: 'sub_chem',
  name: 'Chemistry',
  description: 'Intro chemistry course',
  goal: 'Pass the midterm',
  deadline: '2026-11-03T00:00:00.000Z',
}
const TOPIC_REPOS = {
  subjects: { get: (id: string) => (id === CHEM.id ? CHEM : null) },
  roadmaps: {
    getActive: (id: string) =>
      id === CHEM.id
        ? {
            title: 'Moles from scratch',
            items: [
              { title: 'What a mole is', status: 'done' },
              { title: 'Molar mass', status: 'current' },
              { title: 'Checkpoint', status: 'todo' },
            ],
          }
        : null,
  },
  concepts: {
    listBySubject: (id: string) =>
      id === CHEM.id
        ? [
            { name: 'Avogadro constant', status: 'mastered' },
            { name: 'Molar mass', status: 'struggling' },
          ]
        : [],
  },
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

  it('is a chat: never pastes; a roadmap it is asked for is planned at once, step 1 kept for the tap', async () => {
    const exam: CoachAction = {
      type: 'create_exam',
      spec: { subjectIds: ['s'], count: 5, focus: 'weak', difficulty: 'mixed' },
    }
    const roadmap: CoachAction = { type: 'start_roadmap', subjectId: null, goal: 'Moles' }
    const s = setup({
      aiChat: true,
      actions: [{ type: 'insert_prompt', text: 'Explain moles simply' }, roadmap, exam],
    })
    const result = await s.flow.submit('help me study moles')
    expect(s.writer.write).not.toHaveBeenCalled()
    expect(s.sessions.start).toHaveBeenCalledWith(
      { subjectId: null, goal: 'Moles', question: null },
      { hold: true },
    )
    expect(s.toasts.showToast).not.toHaveBeenCalled()
    expect(result).toEqual({
      reply: 'Hello there.\n\nPlanning a roadmap for “Moles”. I’ll tell you here when it’s ready.',
      actions: [exam],
      pasted: false,
    })
  })

  it('offers adjust_roadmap as a chip and tells the coach it is a chat', async () => {
    const adjust: CoachAction = {
      type: 'adjust_roadmap',
      subjectId: CHEM.id,
      instruction: 'SN1, not SN2',
    }
    const s = setup({ aiChat: true, actions: [adjust] })
    const result = await s.flow.submit('on chemistry I want SN1 not SN2')
    expect(result.actions).toEqual([adjust])
    expect(s.inputs[0]?.context.split('\n')[0]).toMatch(/^Mode: chat\b/)
    expect(s.writer.write).not.toHaveBeenCalled()
  })
})

describe('AskFlow.submit: saves into studying, feedback', () => {
  it('saves a note and a question at once, each with a receipt line and Undo; the rest stay chips', async () => {
    const h = setup({
      feedback: true,
      saves: true,
      reply: ['A mole is a count.'],
      actions: [
        { type: 'add_note', text: 'A mole is 6.022e23', subjectId: null, conceptId: null },
        {
          type: 'save_question',
          text: 'why is a mole that number?',
          subjectId: null,
          conceptId: null,
          topic: 'Moles',
          stuck: false,
        },
        { type: 'set_focus', subjectId: 'sub_chem' },
      ],
    })
    const out = await h.flow.submit('note: a mole is 6.022 × 10²³ particles, but why that number?')
    expect(h.inputs[0]?.context).toMatch(/^Mode: chat\b.*saved at once and shown with Undo/)
    expect(out).toEqual({
      reply: [
        'A mole is a count.',
        'Saved to Chemistry: “A mole is 6.022e23”',
        'Saved to Chemistry: “why is a mole that number?”',
      ].join('\n\n'),
      actions: [
        { type: 'set_focus', subjectId: 'sub_chem' },
        { type: 'undo_save', saveId: 's_add_note' },
        { type: 'undo_save', saveId: 's_save_question' },
      ],
      pasted: false,
    })
  })

  it('stores feedback, never as a chip, and confirms it when the coach said nothing', async () => {
    const h = setup({
      feedback: true,
      reply: [],
      actions: [
        { type: 'give_feedback', text: 'Quizzes are too easy', scope: 'quizzes', subjectId: null },
      ],
    })
    const out = await h.flow.submit('your quizzes are way too easy')
    expect(h.feedback.add).toHaveBeenCalledWith({
      scope: 'quizzes',
      subjectId: null,
      text: 'Quizzes are too easy',
    })
    expect(out.actions).toEqual([])
    expect(out.reply).toMatch(/^Got it/)
  })
})

describe('AskFlow.instruction (/d in the AI chat box)', () => {
  it('still pastes an insert_prompt in place and keeps the rest as toast buttons', async () => {
    const exam: CoachAction = {
      type: 'create_exam',
      spec: { subjectIds: ['s'], count: 5, focus: 'weak', difficulty: 'mixed' },
    }
    const s = setup({
      aiChat: true,
      actions: [{ type: 'insert_prompt', text: 'Explain moles simply' }, exam],
    })
    const result = await s.flow.instruction('moles?')
    expect(s.writer.write).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Explain moles simply', mode: 'insert', target: 'chat' }),
    )
    expect(result).toEqual({ reply: 'Hello there.', actions: [exam], pasted: true })
    expect(s.inputs[0]?.context.startsWith('Mode: chat')).toBe(false)
  })
})

describe('AskFlow.submit with a topic (subjectId)', () => {
  it('leads the coach context with the topic and its own context', async () => {
    const s = setup()
    await s.flow.submit('Why grams?', { subjectId: CHEM.id })
    const context = s.inputs[0]?.context ?? ''
    expect(context.split('\n')[0]).toMatch(/^Mode: chat\b/)
    expect(context.split('\n\n')[1]?.split('\n')[0]).toMatch(/^Topic: Chemistry\b/)
    expect(context).toContain('Goal: Pass the midterm')
    expect(context).toContain('Deadline: 2026-11-03')
    expect(context).toContain('Roadmap: Moles from scratch (1/3 done; now: Molar mass)')
    expect(context).toContain('Struggling with: Molar mass')
    expect(context).not.toContain('Avogadro')
    expect(context.endsWith('Studying chemistry')).toBe(true)
    expect(s.inputs[0]?.message).toBe('Why grams?')
    expect(s.messages[0]?.content).toBe('Why grams?')
  })

  it('without a topic, or with an unknown one, the context is unchanged', async () => {
    const s = setup()
    await s.flow.submit('one')
    await s.flow.submit('two', { subjectId: 'sub_gone' })
    const withoutMode = s.inputs.map((i) => i.context.split('\n\n').slice(1).join('\n\n'))
    expect(withoutMode).toEqual(['Studying chemistry', 'Studying chemistry'])
  })

  it('topicContext skips empty fields and a subject without a roadmap', () => {
    const repos = {
      subjects: { get: () => ({ ...CHEM, description: ' ', goal: null, deadline: null }) },
      roadmaps: { getActive: () => null },
      concepts: { listBySubject: () => [] },
    } as unknown as Parameters<typeof topicContext>[0]
    expect(topicContext(repos, CHEM.id)).toBe(
      'Topic: Chemistry (the student picked this topic for the question)',
    )
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
