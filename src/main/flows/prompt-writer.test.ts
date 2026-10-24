import { createEngineBus } from '@engine/events'
import { describe, expect, it, vi } from 'vitest'
import type { WriteOutcome, WriteRequest } from '../chat/chat-writer'
import type { ToastSpec } from '../overlay/toasts'
import { PromptWriter, type PromptWriterDeps } from './prompt-writer'
import { Thinking } from './thinking'

function setup(opts: {
  prompt?: string
  coachTip?: string | null
  write?: WriteOutcome
  subject?: string | null
  page?: string
}) {
  const log: string[] = []
  const toasts: ToastSpec[] = []
  const improve = vi.fn(
    async (draft: string, _ctx: Parameters<PromptWriterDeps['prompts']['improve']>[1]) => {
      log.push(`improve:${draft}`)
      return { prompt: opts.prompt ?? `Better: ${draft}`, coachTip: opts.coachTip ?? null }
    },
  )
  const writes: WriteRequest[] = []
  const open = new Set(['askbar'])
  const deps: PromptWriterDeps = {
    prompts: { improve },
    perception: {
      aiChat: () =>
        ({ pid: 42, assistant: 'ChatGPT' }) as ReturnType<PromptWriterDeps['perception']['aiChat']>,
      chatExcerpt: () => '',
      pageContext: () => opts.page ?? '',
    },
    writer: {
      write: async (req) => {
        log.push('write')
        writes.push(req)
        return opts.write ?? { ok: true, method: 'paste', reason: null }
      },
    },
    surfaces: {
      isOpen: (s) => open.has(s),
      close: async (s) => {
        log.push(`close:${s}`)
        open.delete(s)
      },
    },
    thinking: new Thinking(createEngineBus()),
    overlay: {
      showToast: (t) => {
        toasts.push(t)
        return 't1'
      },
    },
    subjectName: () => (opts.subject === undefined ? 'Organic Chemistry' : opts.subject),
  }
  return { writer: new PromptWriter(deps), log, toasts, writes, improve }
}

describe('PromptWriter (right ⌥ hold → prompt box)', () => {
  it('writes the prompt first, closes the ask bar, then pastes it into the AI chat', async () => {
    const t = setup({ coachTip: 'Added your exam date and a format.', page: 'SN1 lecture slides' })
    const out = await t.writer.write('  explain SN1 simply, I have an exam Friday ')
    expect(out).toEqual({
      pasted: true,
      prompt: 'Better: explain SN1 simply, I have an exam Friday',
    })
    expect(t.log).toEqual([
      'improve:explain SN1 simply, I have an exam Friday',
      'close:askbar',
      'write',
    ])
    expect(t.writes[0]).toMatchObject({ text: out.prompt, mode: 'insert', target: 'chat' })
    const ctx = t.improve.mock.calls[0]?.[1]
    expect(ctx).toEqual({
      assistant: 'ChatGPT',
      chatExcerpt: '',
      pageContext: 'Subject: Organic Chemistry\nSN1 lecture slides',
    })
    expect(t.toasts.map((x) => x.title)).toEqual(['Why this prompt works'])
  })

  it('leaves the page context alone when no subject is known', async () => {
    const t = setup({ subject: null, page: 'Wikipedia: Osmosis' })
    await t.writer.write('quiz me')
    expect(t.improve.mock.calls[0]?.[1].pageContext).toBe('Wikipedia: Osmosis')
  })

  it('reports pasted: false when the paste failed (the ChatWriter copied it)', async () => {
    const t = setup({
      coachTip: 'tip',
      write: { ok: false, method: 'clipboard', reason: 'Could not find the chat box' },
    })
    const out = await t.writer.write('make flashcards')
    expect(out.pasted).toBe(false)
    expect(out.prompt).toBe('Better: make flashcards')
    expect(t.toasts).toEqual([])
  })

  it('refuses an empty wish, and keeps the ask bar open when no prompt comes back', async () => {
    const empty = setup({})
    await expect(empty.writer.write('   ')).rejects.toThrow(/what the prompt should ask/)
    expect(empty.log).toEqual([])

    const blank = setup({ prompt: '  ' })
    await expect(blank.writer.write('explain SN1')).rejects.toThrow(/could not write a prompt/)
    expect(blank.log).toEqual(['improve:explain SN1'])
  })
})
