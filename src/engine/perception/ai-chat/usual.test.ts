import { describe, expect, it } from 'vitest'
import { assistantByKey } from './assistants'
import { assistantLink, usualAssistant } from './usual'

const NOW = Date.parse('2026-10-25T12:00:00.000Z')
const daysAgo = (d: number) => new Date(NOW - d * 86_400_000).toISOString()
const at = (
  url: string | null,
  bundleId: string | null,
  dwell: number,
  days: number,
  title = '',
) => ({
  source: { app: 'Browser', bundleId, url, title },
  dwellSeconds: dwell,
  createdAt: daysAgo(days),
})

describe('usualAssistant', () => {
  it('picks the AI chat with the most recent study time', () => {
    const captures = [
      at('https://chatgpt.com/c/1', 'com.google.Chrome', 600, 30),
      at('https://chatgpt.com/c/2', 'com.google.Chrome', 600, 28),
      at('https://claude.ai/chat/1', 'com.google.Chrome', 400, 1),
      at('https://claude.ai/chat/2', 'com.google.Chrome', 300, 0),
      at('https://en.wikipedia.org/wiki/SN1', 'com.google.Chrome', 3000, 0),
    ]
    expect(usualAssistant(captures, NOW)?.name).toBe('Claude')
  })

  it('recognises desktop apps and any catalogued assistant, not just two', () => {
    expect(usualAssistant([at(null, 'com.openai.chat', 300, 0, 'ChatGPT')], NOW)?.key).toBe(
      'chatgpt',
    )
    expect(
      usualAssistant([at('https://gemini.google.com/app', 'com.apple.Safari', 300, 0)], NOW)?.key,
    ).toBe('gemini')
    expect(
      usualAssistant([at('https://www.perplexity.ai/search/x', 'com.google.Chrome', 300, 0)], NOW)
        ?.key,
    ).toBe('perplexity')
  })

  it('is null without AI chat captures', () => {
    expect(
      usualAssistant([at('https://en.wikipedia.org/wiki/SN1', 'com.google.Chrome', 300, 0)], NOW),
    ).toBeNull()
  })
})

describe('assistantLink', () => {
  it('prefills Claude and opens the others without sending', () => {
    const claude = assistantByKey('claude')
    const chatgpt = assistantByKey('chatgpt')
    if (!claude || !chatgpt) throw new Error('catalog')
    expect(assistantLink(claude, 'Explain SN1 & SN2')).toEqual({
      url: 'https://claude.ai/new?q=Explain%20SN1%20%26%20SN2',
      prefilled: true,
    })
    expect(assistantLink(chatgpt, 'Explain SN1')).toEqual({
      url: 'https://chatgpt.com/',
      prefilled: false,
    })
  })
})
