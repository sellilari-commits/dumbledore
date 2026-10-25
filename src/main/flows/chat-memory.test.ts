import { FakeClock } from '@engine/clock'
import { createMemoryRepos } from '@engine/testing/memory-repos'
import { describe, expect, it, vi } from 'vitest'
import { ChatMemory } from './chat-memory'

function chat(turns: number, words = 60) {
  const clock = new FakeClock('2026-10-25T08:00:00.000Z')
  const repos = createMemoryRepos(clock)
  for (let i = 1; i <= turns; i++) {
    clock.advance(1000)
    repos.chat.append({
      thread: 'ask',
      role: 'user',
      content: `Question ${i}: ${'word '.repeat(words)}`,
      actions: [],
    })
    clock.advance(1000)
    repos.chat.append({
      thread: 'ask',
      role: 'assistant',
      content: `Answer ${i}.`,
      actions: [{ type: 'undo_save', saveId: `undo_${i}`, label: `Saved note ${i}` }],
    })
  }
  return { clock, repos }
}

describe('chat memory: summarising a long chat', () => {
  it('sends a short chat whole, without a summary call', async () => {
    const { repos } = chat(3)
    const summarize = vi.fn()
    const history = await new ChatMemory({ chat: repos.chat, summarize }).history(null)
    expect(history).toHaveLength(6)
    expect(history[1]?.content).toBe('Answer 1.\nDone: Saved note 1')
    expect(summarize).not.toHaveBeenCalled()
  })

  it('folds the older part into a cached summary and keeps recent turns verbatim', async () => {
    const { repos } = chat(40)
    const summarize = vi.fn(async (input: { previous: string; transcript: string }) => ({
      summary: `Summary covering ${input.transcript.match(/Question \d+/g)?.length} questions`,
    }))
    const memory = new ChatMemory({ chat: repos.chat, summarize, budgetTokens: 2000 })
    const history = await memory.history(null)
    expect(summarize).toHaveBeenCalledTimes(1)
    const first = history[0]
    expect(first?.role).toBe('user')
    expect(first?.content).toMatch(
      /^\[Summary of the earlier part of this chat\]\nSummary covering \d+ questions/,
    )
    // The recent part is verbatim, ends with the latest turn and starts with a student message.
    expect(history.at(-1)?.content).toBe('Answer 40.\nDone: Saved note 40')
    expect(first?.content).toMatch(/Question \d+: word/)
    const verbatim = history.length / 2
    expect(verbatim).toBeLessThan(40)
    expect(summarize.mock.calls[0]?.[0].transcript).toContain('Done: Saved note 1')

    // Next turn: cached, no new summary call.
    repos.chat.append({ thread: 'ask', role: 'user', content: 'one more', actions: [] })
    repos.chat.append({ thread: 'ask', role: 'assistant', content: 'Sure.', actions: [] })
    await memory.history(null)
    expect(summarize).toHaveBeenCalledTimes(1)

    // A fresh instance (an app restart) reads the cache too.
    const again = await new ChatMemory({ chat: repos.chat, summarize, budgetTokens: 2000 }).history(
      null,
    )
    expect(summarize).toHaveBeenCalledTimes(1)
    expect(again[0]?.content).toContain('Summary covering')
  })

  it('folds again on top of the previous summary once the recent part outgrows the budget', async () => {
    const { repos } = chat(30)
    const summarize = vi.fn(async (input: { previous: string }) => ({
      summary: input.previous ? `${input.previous} + more` : 'first',
    }))
    const memory = new ChatMemory({ chat: repos.chat, summarize, budgetTokens: 2000 })
    await memory.history(null)
    for (let i = 0; i < 30; i++) {
      repos.chat.append({ thread: 'ask', role: 'user', content: 'word '.repeat(60), actions: [] })
      repos.chat.append({ thread: 'ask', role: 'assistant', content: 'Ok.', actions: [] })
    }
    const history = await memory.history(null)
    expect(summarize).toHaveBeenCalledTimes(2)
    expect(history[0]?.content).toContain('first + more')
  })

  it('without a summariser (or when it fails) keeps a plain list of the older turns', async () => {
    const { repos } = chat(40)
    const log = vi.fn()
    const summarize = vi.fn(async () => {
      throw new Error('rate limited')
    })
    const history = await new ChatMemory({
      chat: repos.chat,
      summarize,
      budgetTokens: 2000,
      log,
    }).history(null)
    // The newest of the older turns are kept when the list gets long.
    expect(history[0]?.content).toMatch(/- Student: Question \d+: word/)
    expect(history[0]?.content).toMatch(/- Dumbledore: Answer \d+\.\n {2}Done: Saved note \d+/)
    expect(log).toHaveBeenCalledWith(expect.stringContaining('rate limited'))
  })

  it('a summary from before "New chat" no longer applies', async () => {
    const { repos, clock } = chat(40)
    const summarize = vi.fn(async () => ({ summary: 'old chat' }))
    const memory = new ChatMemory({ chat: repos.chat, summarize, budgetTokens: 2000 })
    await memory.history(null)
    clock.advance(1000)
    const since = Date.parse(clock.nowIso())
    clock.advance(1000)
    repos.chat.append({ thread: 'ask', role: 'user', content: 'new topic', actions: [] })
    const history = await memory.history(since)
    expect(history).toEqual([{ role: 'user', content: 'new topic' }])
  })
})
