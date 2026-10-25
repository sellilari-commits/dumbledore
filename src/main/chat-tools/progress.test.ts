/**
 * The chat's working indicator, main side: the label for each tool call, withProgress around a
 * turn's tools, and the 'chat.progress' events AskFlow sends while the tool loop runs.
 */
import type { Brain, CoachEvent, CoachInput, CoachTools } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import type { ChatMessage } from '@shared/domain'
import type { EventPayload } from '@shared/ipc'
import { describe, expect, it } from 'vitest'
import { AskFlow, type AskFlowDeps } from '../flows/ask-flow'
import type { ChatTurnTools } from './index'
import { progressLabel, THINKING_LABEL, WORKING_LABEL, withProgress } from './progress'

describe('progressLabel', () => {
  it.each([
    ['read', { kind: 'roadmap' }, 'Reading your roadmap…'],
    ['read', { kind: 'roadmaps' }, 'Reading your roadmap…'],
    ['read', { kind: 'notes' }, 'Reading your notes…'],
    ['read', { kind: 'gaps' }, 'Checking your gaps…'],
    ['search', { query: 'colliders' }, 'Searching your notes…'],
    ['web_search', { query: 'd-separation' }, 'Searching the web…'],
    ['create', { kind: 'subject', data: '{}' }, 'Creating the course…'],
    ['create', { kind: 'note', data: '{}' }, 'Updating your notes…'],
    ['update', { kind: 'note', id: 'n1', patch: '{}' }, 'Updating your notes…'],
    ['update', { kind: 'roadmap_step', id: 'i1', patch: '{}' }, 'Updating your roadmap…'],
    ['delete', { kind: 'note', id: 'n1' }, 'Getting the delete ready…'],
    ['act', { name: 'start_roadmap', args: '{}' }, 'Planning your roadmap…'],
    ['act', { name: 'add_note', args: '{}' }, 'Updating your notes…'],
    ['act', { name: ' create_exam ', args: '{}' }, 'Creating the exam…'],
    ['act', { name: 'write_prompt', args: '{}' }, 'Writing the prompt…'],
    ['act', { name: 'session.next', args: '{}' }, 'Getting your next step…'],
  ])('%s %j → %s', (name, input, label) => {
    expect(progressLabel(name, input)).toBe(label)
  })

  it('falls back for unknown tools, kinds and acts, and for input that is not an object', () => {
    expect(progressLabel('mystery', {})).toBe(WORKING_LABEL)
    expect(progressLabel('act', { name: 'launch_rockets' })).toBe(WORKING_LABEL)
    expect(progressLabel('act', { name: 'toString' })).toBe(WORKING_LABEL)
    expect(progressLabel('read', { kind: 'secrets' })).toBe('Looking that up…')
    expect(progressLabel('read', null)).toBe('Looking that up…')
    expect(progressLabel('create', 'subject')).toBe('Saving that…')
    expect(progressLabel('update', { kind: 42 })).toBe('Updating that…')
  })

  it('every label is short and ends in an ellipsis', () => {
    const samples = [
      ...[
        'subjects',
        'subject',
        'topic',
        'notes',
        'roadmap_history',
        'encounters',
        'session',
        'profile',
      ].map((kind) => progressLabel('read', { kind })),
      ...['subject', 'topic', 'feedback', 'assignment'].map((kind) =>
        progressLabel('create', { kind }),
      ),
      ...['settings', 'profile', 'assignment'].map((kind) => progressLabel('update', { kind })),
      ...['set_focus', 'open_subject', 'study_now', 'paste_prompt', 'window.open'].map((name) =>
        progressLabel('act', { name }),
      ),
    ]
    for (const label of samples) {
      expect(label).toMatch(/…$/)
      expect(label.length).toBeLessThanOrEqual(36)
    }
  })
})

function fakeTools(fail = false): CoachTools & { ran: string[] } {
  const ran: string[] = []
  return {
    ran,
    specs: [{ name: 'read', description: 'Read', parameters: {} }],
    async run(name) {
      ran.push(name)
      if (fail) throw new Error('boom')
      return { ok: true, result: {} }
    },
  }
}

describe('withProgress', () => {
  it('says the step when a call starts and Thinking… when it ends', async () => {
    const tools = fakeTools()
    const seen: string[] = []
    const wrapped = withProgress(tools, (label) => seen.push(`${label} (${tools.ran.length} ran)`))
    expect(wrapped.specs).toBe(tools.specs)
    const out = await wrapped.run('read', { kind: 'roadmap' })
    expect(out).toEqual({ ok: true, result: {} })
    expect(seen).toEqual(['Reading your roadmap… (0 ran)', `${THINKING_LABEL} (1 ran)`])
  })

  it('goes back to Thinking… after a call that throws, and an emit that throws breaks nothing', async () => {
    const seen: string[] = []
    const failing = withProgress(fakeTools(true), (label) => seen.push(label))
    await expect(failing.run('web_search', { query: 'x' })).rejects.toThrow('boom')
    expect(seen).toEqual(['Searching the web…', THINKING_LABEL])
    const loud = withProgress(fakeTools(), () => {
      throw new Error('window gone')
    })
    await expect(loud.run('read', { kind: 'notes' })).resolves.toEqual({ ok: true, result: {} })
  })
})

describe('AskFlow: chat.progress while the tool loop runs', () => {
  function setup(script: (tools: CoachTools) => AsyncGenerator<CoachEvent>) {
    const messages: ChatMessage[] = []
    const events: string[] = []
    const tools = fakeTools()
    const turn: ChatTurnTools = {
      specs: tools.specs,
      run: tools.run,
      receipts: [],
      chips: [],
      calls: [],
      sources: () => [],
      actions: () => [],
    }
    const brain = {
      coach: () => {
        throw new Error('the loop path must not call coach()')
      },
      coachLoop: (_input: CoachInput, loopTools: CoachTools) => script(loopTools),
    }
    const deps = {
      brain: brain as unknown as Brain,
      repos: {
        chat: {
          append: (m: Omit<ChatMessage, 'id' | 'createdAt'>) => {
            const message = { ...m, id: `msg_${messages.length + 1}`, createdAt: '' }
            messages.push(message)
            return message
          },
          history: () => [],
        },
        profile: { get: () => ({ summary: '' }) },
      } as unknown as Repos,
      perception: { aiChat: () => null },
      sessions: { start: async () => ({}) },
      writer: { write: async () => ({ ok: true }) },
      thinking: { run: (_label: string, fn: () => Promise<unknown>) => fn() },
      overlay: { showToast: () => 'toast' },
      contextText: () => '',
      runAction: async () => undefined,
      emitDelta: (d: EventPayload<'chat.delta'>) =>
        events.push(d.done ? `done ${d.messageId}` : `text ${d.messageId}: ${d.delta}`),
      emitProgress: (p: EventPayload<'chat.progress'>) =>
        events.push(`step ${p.thread}/${p.messageId}: ${p.label}`),
      chatTools: { turn: () => turn },
    } as unknown as AskFlowDeps
    return { flow: new AskFlow(deps), events, tools }
  }

  it('emits each tool step, then Thinking…, in order with the streamed reply', async () => {
    const { flow, events, tools } = setup(async function* (loopTools) {
      await loopTools.run('read', { kind: 'roadmap', id: null })
      await loopTools.run('web_search', { query: 'd-separation' })
      yield { type: 'text', delta: 'Step 3 is next.' }
      await loopTools.run('update', { kind: 'note', id: 'n1', patch: '{}' })
      yield { type: 'text', delta: ' Noted.' }
      yield { type: 'done' }
    })
    const result = await flow.submit('what is next on my roadmap?')
    expect(result.reply).toBe('Step 3 is next. Noted.')
    expect(tools.ran).toEqual(['read', 'web_search', 'update'])
    const id = 'ask_pending_1'
    expect(events).toEqual([
      `step ask/${id}: Reading your roadmap…`,
      `step ask/${id}: Thinking…`,
      `step ask/${id}: Searching the web…`,
      `step ask/${id}: Thinking…`,
      `text ${id}: Step 3 is next.`,
      `step ask/${id}: Updating your notes…`,
      `step ask/${id}: Thinking…`,
      `text ${id}:  Noted.`,
      `done ${id}`,
    ])
  })

  it('a turn without tools sends no progress (the bar shows Thinking… on its own)', async () => {
    const { flow, events } = setup(async function* () {
      yield { type: 'text', delta: 'Hi.' }
    })
    await flow.submit('hi')
    expect(events.filter((e) => e.startsWith('step'))).toEqual([])
  })

  it('a loop that fails after a step still ends the stream (the bar then shows the error)', async () => {
    // biome-ignore lint/correctness/useYield: the loop fails before its first event
    const { flow, events } = setup(async function* (loopTools) {
      await loopTools.run('read', { kind: 'notes' })
      throw new Error('Gemini is busy')
    })
    await expect(flow.submit('read my notes')).rejects.toThrow('Gemini is busy')
    expect(events).toEqual([
      'step ask/ask_pending_1: Reading your notes…',
      'step ask/ask_pending_1: Thinking…',
      'done ask_pending_1',
    ])
  })
})
