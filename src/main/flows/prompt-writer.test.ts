import { createEngineBus } from '@engine/events'
import type { SessionState, StartSessionInput, StepInstruction } from '@shared/state'
import { describe, expect, it, vi } from 'vitest'
import { PromptWriter, type PromptWriterDeps } from './prompt-writer'
import type { StepResult } from './session-flow'
import { Thinking } from './thinking'

const FIRST: StepInstruction = {
  kind: 'paste',
  text: 'I am new to SN1. Explain the two steps simply.',
  coachTip: null,
  itemId: 'itm_1',
} as StepInstruction

function setup(opts: { aiChat?: boolean; pasted?: boolean; step?: StepInstruction } = {}) {
  const log: string[] = []
  const open = new Set(['askbar'])
  const step = opts.step ?? FIRST
  const sessionsStart = vi.fn(async (input: StartSessionInput): Promise<StepResult> => {
    log.push(`session:${input.goal}`)
    return {
      session: null,
      instruction: step,
      write: { ok: opts.pasted ?? true, method: 'paste', reason: null },
    } as StepResult
  })
  const studyStart = vi.fn(async (input: StartSessionInput) => {
    log.push(`plan:${input.goal}`)
    return step
  })
  const pasteFailed = vi.fn((itemId: string) => log.push(`waits:${itemId}`))
  const deps: PromptWriterDeps = {
    sessions: { start: sessionsStart },
    study: {
      start: studyStart,
      pasteFailed,
      current: () => ({ subjectId: 'sub_orgo' }) as SessionState,
    },
    perception: {
      aiChat: () =>
        (opts.aiChat === false ? null : { pid: 42, assistant: 'ChatGPT' }) as ReturnType<
          PromptWriterDeps['perception']['aiChat']
        >,
      chatExcerpt: () => '',
      pageContext: () => '',
    },
    surfaces: {
      isOpen: (s) => open.has(s),
      close: async (s) => {
        log.push(`close:${s}`)
        open.delete(s)
      },
      open: async (s, o) => {
        log.push(`open:${s}:${o?.route ?? ''}`)
      },
    },
    thinking: new Thinking(createEngineBus()),
  }
  return { writer: new PromptWriter(deps), log, sessionsStart, studyStart, pasteFailed }
}

describe('PromptWriter (right ⌥ hold → "Open a topic")', () => {
  it('starts the subject and its roadmap, then pastes the first step into the AI chat', async () => {
    const t = setup()
    const out = await t.writer.write('  SN1 reactions for my exam Friday ')
    expect(t.sessionsStart).toHaveBeenCalledWith(
      { subjectId: null, goal: 'SN1 reactions for my exam Friday', question: null },
      { signal: undefined },
    )
    expect(out).toEqual({ pasted: true, prompt: FIRST.kind === 'paste' ? FIRST.text : '' })
    expect(t.studyStart).not.toHaveBeenCalled()
  })

  it('reports a failed paste (the ChatWriter already copied it)', async () => {
    const t = setup({ pasted: false })
    expect(await t.writer.write('SN1')).toMatchObject({ pasted: false })
  })

  it('without an AI chat: plans the roadmap, keeps the first step for the next tap, opens it', async () => {
    const t = setup({ aiChat: false })
    const out = await t.writer.write('Linear algebra basics')
    expect(t.sessionsStart).not.toHaveBeenCalled()
    expect(t.log).toEqual([
      'plan:Linear algebra basics',
      'waits:itm_1',
      'close:askbar',
      'open:app:/subjects/sub_orgo/roadmap',
    ])
    expect(out.pasted).toBe(false)
  })

  it('refuses an empty goal', async () => {
    const t = setup()
    await expect(t.writer.write('   ')).rejects.toThrow(/what you want to study/)
    expect(t.sessionsStart).not.toHaveBeenCalled()
  })
})
