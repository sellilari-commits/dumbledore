import { ASSISTANT_NAMES } from '@shared/llm'
import { describe, expect, it } from 'vitest'
import type { AiChatInfo } from '../../contracts'
import type { WindowLike } from '../types'
import { ASSISTANTS, chatInputPlaceholders } from './assistants'
import { detectAssistant } from './detector'
import { AiChatTracker } from './tracker'

const browser = (
  url: string | null,
  title: string | null = 'Page',
  lines: string[] = [],
): WindowLike => ({
  pid: 10,
  bundleId: 'com.google.Chrome',
  appName: 'Google Chrome',
  windowId: 1,
  title,
  url,
  lines: lines.map((text) => ({ text, align: 'left' as const })),
})

describe('detectAssistant', () => {
  it('has a config for every assistant name the prompts can address', () => {
    expect(ASSISTANTS.map((a) => a.key).sort()).toEqual(Object.keys(ASSISTANT_NAMES).sort())
  })

  it.each([
    ['https://chatgpt.com/c/6721', 'chatgpt'],
    ['https://chat.openai.com/', 'chatgpt'],
    ['https://claude.ai/chat/abc', 'claude'],
    ['https://gemini.google.com/app', 'gemini'],
    ['https://aistudio.google.com/prompts/new_chat', 'gemini'],
    ['https://www.perplexity.ai/search/why-x', 'perplexity'],
    ['https://copilot.microsoft.com/chats/1', 'copilot'],
    ['https://chat.mistral.ai/chat', 'mistral'],
    ['https://chat.deepseek.com/a/chat/s/1', 'deepseek'],
    ['https://grok.com/chat/1', 'grok'],
    ['https://x.com/i/grok?conversation=1', 'grok'],
  ])('recognises %s by URL', (url, key) => {
    const match = detectAssistant(browser(url))
    expect(match?.assistant.key).toBe(key)
    expect(match?.via).toBe('url')
  })

  it('recognises the desktop apps by bundle id', () => {
    const app = (bundleId: string) => ({ bundleId, url: null, title: null })
    expect(detectAssistant(app('com.openai.chat'))?.assistant.key).toBe('chatgpt')
    expect(detectAssistant(app('com.anthropic.claudefordesktop'))?.assistant.key).toBe('claude')
    expect(detectAssistant(app('ai.perplexity.mac'))?.assistant.key).toBe('perplexity')
  })

  it('does not treat other pages as chats, even articles about ChatGPT', () => {
    expect(
      detectAssistant(
        browser('https://en.wikipedia.org/wiki/ChatGPT', 'ChatGPT - Wikipedia', [
          'Message ChatGPT',
        ]),
      ),
    ).toBeNull()
    expect(detectAssistant(browser('https://x.com/home'))).toBeNull()
    expect(detectAssistant(browser('https://www.gemini.com/'))).toBeNull()
    expect(
      detectAssistant({ bundleId: 'com.apple.Preview', url: null, title: 'notes.pdf' }),
    ).toBeNull()
  })

  it.each([
    ['ChatGPT can make mistakes. Check important info.', 'chatgpt'],
    ['Reply to Claude…', 'claude'],
    ['Ask Gemini', 'gemini'],
    ['Ask a follow-up', 'perplexity'],
    ['Message Copilot', 'copilot'],
    ['Ask Le Chat or @mention an agent', 'mistral'],
    ['Message DeepSeek', 'deepseek'],
    ['How can Grok help?', 'grok'],
  ])('falls back to the text marker "%s" when no URL is known', (marker, key) => {
    const match = detectAssistant(browser(null, 'Untitled', ['Some answer text', marker]))
    expect(match?.assistant.key).toBe(key)
    expect(match?.via).toBe('text')
  })

  it('uses a generic marker only together with a title hint', () => {
    expect(detectAssistant(browser(null, 'Notes', ['Ask anything']))).toBeNull()
    const match = detectAssistant(browser(null, 'ChatGPT', ['Ask anything']))
    expect(match).toMatchObject({ via: 'title_text', assistant: { key: 'chatgpt' } })
  })

  it('ignores markers inside long paragraphs', () => {
    const long = `${'An essay sentence. '.repeat(10)}Message ChatGPT and see.`
    expect(detectAssistant(browser(null, 'Essay', [long]))).toBeNull()
  })

  it('gives ax.findChatInput the assistant placeholders first', () => {
    const placeholders = chatInputPlaceholders('chatgpt')
    expect(placeholders[0]).toBe('Ask anything')
    expect(placeholders).toContain('Message ChatGPT')
    expect(chatInputPlaceholders().length).toBeGreaterThan(10)
  })
})

describe('AiChatTracker', () => {
  const chat = browser('https://chatgpt.com/c/1', 'ChatGPT')
  const wiki = { ...browser('https://en.wikipedia.org/wiki/Osmosis', 'Osmosis'), windowId: 2 }

  it('emits only on change', () => {
    const seen: (AiChatInfo | null)[] = []
    const tracker = new AiChatTracker((c) => seen.push(c))
    tracker.observeFrontmost(chat)
    tracker.observeFrontmost(chat)
    tracker.observeFrontmost(wiki)
    expect(seen.map((c) => c?.key ?? null)).toEqual(['chatgpt', null])
    expect(seen[0]).toMatchObject({ assistant: 'ChatGPT', pid: 10, url: 'https://chatgpt.com/c/1' })
  })

  it('keeps a chat that is visible beside the frontmost window', () => {
    const tracker = new AiChatTracker()
    tracker.observeVisible([wiki, chat])
    tracker.observeFrontmost(wiki)
    expect(tracker.get()?.key).toBe('chatgpt')
    tracker.observeVisible([wiki])
    expect(tracker.get()).toBeNull()
  })

  it('remembers text-detected chats on unchanged frames and resets', () => {
    const tracker = new AiChatTracker()
    tracker.observeFrontmost(browser(null, 'Untitled', ['Message DeepSeek']))
    tracker.observeFrontmost(browser(null, 'Untitled', []))
    expect(tracker.get()?.key).toBe('deepseek')
    tracker.reset()
    expect(tracker.get()).toBeNull()
  })
})
