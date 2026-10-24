/**
 * Every AI chat, known or unknown, on the web and as an app — and the text boxes that are not AI
 * chats (email, documents, messaging, search, code). Each case is one window as perception sees
 * it, optionally with the composer the student focused.
 */
import { describe, expect, it } from 'vitest'
import type { WindowLike } from '../types'
import { ASSISTANTS, UNKNOWN_CHAT_KEY } from './assistants'
import { composerOf, type FocusLike } from './composer'
import { detectAssistant } from './detector'

type Win = Omit<WindowLike, 'pid' | 'windowId' | 'appName'>
type Line = string | { text: string; align: 'left' | 'center' | 'right' }

const CHROME = 'com.google.Chrome'
const toLines = (lines: Line[]) =>
  lines.map((l) => (typeof l === 'string' ? { text: l, align: 'left' as const } : l))
const page = (url: string, title: string | null = 'Page', lines: Line[] = []): Win => ({
  bundleId: CHROME,
  title,
  url,
  lines: toLines(lines),
})
const appWin = (bundleId: string, title: string | null = null, lines: Line[] = []): Win => ({
  bundleId,
  title,
  url: null,
  lines: toLines(lines),
})
const field = (placeholder: string | null, over: Partial<FocusLike> = {}) =>
  composerOf({
    pid: 10,
    role: 'AXTextArea',
    subrole: null,
    editable: true,
    isSecure: false,
    placeholder,
    frame: { x: 300, y: 700, width: 720, height: 48 },
    ...over,
  })

describe('known assistants on the web', () => {
  it.each([
    ['https://chatgpt.com/c/6721', 'chatgpt'],
    ['https://claude.ai/new', 'claude'],
    ['https://gemini.google.com/app/1f2e', 'gemini'],
    ['https://aistudio.google.com/prompts/new_chat', 'gemini'],
    ['https://copilot.microsoft.com/chats/9', 'copilot'],
    ['https://m365.cloud.microsoft/chat/?auth=2', 'copilot'],
    ['https://www.perplexity.ai/search/why-x', 'perplexity'],
    ['https://grok.com/c/1', 'grok'],
    ['https://x.com/i/grok?conversation=1', 'grok'],
    ['https://chat.mistral.ai/chat/1', 'mistral'],
    ['https://chat.deepseek.com/a/chat/s/1', 'deepseek'],
    ['https://www.meta.ai/prompt/1', 'meta'],
    ['https://poe.com/chat/abc', 'poe'],
    ['https://huggingface.co/chat/conversation/1', 'huggingchat'],
    ['https://www.kimi.com/chat/1', 'kimi'],
    ['https://kimi.moonshot.cn/', 'kimi'],
    ['https://chat.qwen.ai/c/1', 'qwen'],
    ['https://www.phind.com/search?cache=1', 'phind'],
    ['https://you.com/search?q=osmosis&tbm=youchat', 'you'],
    ['https://notebooklm.google.com/notebook/1', 'notebooklm'],
    ['https://notebook.google.com/notebook/1', 'notebooklm'],
    ['https://www.google.com/search?q=osmosis&udm=50', 'google-ai-mode'],
    ['https://duck.ai/chat?q=1', 'duck-ai'],
    ['https://github.com/copilot/c/1', 'github-copilot'],
    ['https://openrouter.ai/chat', 'openrouter'],
    ['https://lmarena.ai/c/1', 'arena'],
    ['https://pi.ai/talk', 'pi'],
    ['https://character.ai/chat/1', 'character-ai'],
    ['https://t3.chat/chat/1', 't3-chat'],
    ['https://chat.z.ai/c/1', 'z-ai'],
    ['https://www.doubao.com/chat/1', 'doubao'],
    ['https://yuanbao.tencent.com/chat/1', 'yuanbao'],
  ])('%s → %s', (url, key) => {
    expect(detectAssistant(page(url))).toMatchObject({ via: 'url', assistant: { key } })
  })

  it('every catalog site leads back to its own assistant', () => {
    for (const a of ASSISTANTS) {
      for (const site of a.sites) {
        const query = site.param ? `?${site.param[0]}=${site.param[1]}` : ''
        const url = `https://${site.host}${site.pathPrefix ?? '/'}${query}`
        expect(detectAssistant(page(url))?.assistant.key, url).toBe(a.key)
      }
    }
  })
})

describe('known assistants as desktop apps', () => {
  it.each([
    ['com.openai.codex', 'chatgpt'],
    ['com.openai.chat', 'chatgpt'],
    ['com.anthropic.claudefordesktop', 'claude'],
    ['com.google.GeminiMacOS', 'gemini'],
    ['ai.perplexity.macv3', 'perplexity'],
    ['com.microsoft.copilot-mac', 'copilot'],
    ['com.microsoft.m365copilot', 'copilot'],
    ['com.quora.poe.electron', 'poe'],
    ['cyrilzakka.HuggingChat-Mac', 'huggingchat'],
    ['com.moonshot.kimichat', 'kimi'],
    ['com.alibaba.tongyi', 'qwen'],
    ['ai.elementlabs.lmstudio', 'lm-studio'],
    ['jan.ai.app', 'jan'],
    ['app.msty.app', 'msty'],
    ['co.podzim.boltai-mobile', 'boltai'],
    ['com.electron.ollama', 'ollama'],
    ['com.kevinhermawan.Ollamac', 'ollamac'],
    ['subj.Enchanted', 'enchanted'],
    ['xyz.chatboxapp.app', 'chatbox'],
    ['com.kangfenmao.CherryStudio', 'cherry-studio'],
    ['com.nomic-ai.gpt4all', 'gpt4all'],
  ])('%s → %s', (bundleId, key) => {
    expect(detectAssistant(appWin(bundleId))).toMatchObject({ via: 'bundle', assistant: { key } })
  })

  it('counts Raycast only in its AI Chat window', () => {
    expect(detectAssistant(appWin('com.raycast.macos', 'AI Chat'))?.assistant.key).toBe(
      'raycast-ai',
    )
    expect(detectAssistant(appWin('com.raycast.macos', 'Raycast'))).toBeNull()
  })

  it('every catalog bundle id leads back to its own assistant', () => {
    for (const a of ASSISTANTS) {
      for (const id of a.bundleIds) {
        expect(detectAssistant(appWin(id, 'AI Chat'))?.assistant.key, id).toBe(a.key)
      }
    }
  })
})

describe('assistants recognised by their composer while the student types', () => {
  it('names Copilot in the Edge sidebar on any page', () => {
    const win = {
      ...page('https://en.wikipedia.org/wiki/Osmosis'),
      bundleId: 'com.microsoft.edgemac',
    }
    expect(detectAssistant(win, field('Message Copilot'))).toMatchObject({
      via: 'composer',
      assistant: { key: 'copilot' },
    })
  })

  it('names Gemini by "Ask Gemini" where the browser gives no URL', () => {
    expect(detectAssistant(page('', 'Untitled'), field('Ask Gemini'))?.assistant.key).toBe('gemini')
  })
})

const OPEN_WEBUI: Line[] = [
  'New Chat',
  'Search',
  'llama3.2:latest',
  { text: 'explain osmosis like I am 12', align: 'right' },
  { text: 'Osmosis is water moving through a membrane toward the saltier side.', align: 'left' },
  'How can I help you today?',
  'LLMs can make mistakes. Verify important information.',
]

describe('unknown LLM UIs', () => {
  it('recognises Open WebUI on localhost by its composer and screen', () => {
    const win = page('http://localhost:3000/c/8f1e', 'Osmosis | Open WebUI', OPEN_WEBUI)
    const match = detectAssistant(win, field('How can I help you today?'))
    expect(match).toMatchObject({
      via: 'composer',
      assistant: { key: UNKNOWN_CHAT_KEY, name: 'AI chat' },
    })
  })

  it('recognises Open WebUI even when the composer has no placeholder (contenteditable)', () => {
    const win = page('http://127.0.0.1:8080/', 'Open WebUI', OPEN_WEBUI)
    expect(detectAssistant(win, field(null))?.assistant.key).toBe(UNKNOWN_CHAT_KEY)
  })

  it('recognises an unknown hosted LLM site', () => {
    const win = page('https://chat.example-llm.org/c/abc', 'Example', [
      'Llama 3.3 70B',
      'Regenerate',
      { text: 'what is a derivative?', align: 'right' },
      { text: 'A derivative measures how fast a function changes.', align: 'left' },
    ])
    expect(detectAssistant(win, field('Send a message'))?.assistant.key).toBe(UNKNOWN_CHAT_KEY)
  })

  it('recognises an unknown desktop LLM app', () => {
    const win = appWin('com.example.localchat', 'Local AI', ['Qwen3-8B', 'New chat'])
    expect(detectAssistant(win, field('Message the model…'))?.assistant.key).toBe(UNKNOWN_CHAT_KEY)
  })

  it('needs the composer: the same screen without a focused composer is not a chat', () => {
    expect(detectAssistant(page('http://localhost:3000/', 'Open WebUI', OPEN_WEBUI))).toBeNull()
  })
})

describe('text boxes that are not AI chats', () => {
  const about = page('https://blog.example.com/chatgpt-study-tips', 'How I study with ChatGPT', [
    'How I study with ChatGPT',
    'Message ChatGPT',
    'ChatGPT can make mistakes. Check important info.',
    'GPT-5',
    `${'I paste my notes and ask for a quiz. '.repeat(5)}`,
  ])

  it.each<[string, Win, ReturnType<typeof field>]>([
    ['a blog post about ChatGPT (comment box)', about, field('Write a comment…')],
    ['a blog post about ChatGPT (no focus)', about, null],
    [
      'Google Docs with the Gemini panel open',
      page('https://docs.google.com/document/d/1/edit', 'Essay - Google Docs', [
        'Gemini',
        'Gemini can make mistakes, so double-check it',
        'Gemini 3.5 Flash',
      ]),
      field(null),
    ],
    [
      'Gmail compose',
      page('https://mail.google.com/mail/u/0/#inbox?compose=new', 'Inbox - Gmail', [
        'New Message',
        'To',
        'Subject',
        'Help me write',
      ]),
      field(null),
    ],
    ['Apple Mail', appWin('com.apple.mail', 'New Message', ['To:', 'Subject:']), field(null)],
    [
      'Slack app',
      appWin('com.tinyspeck.slackmacgap', 'general (Channel) - Slack', [
        'ai-tools',
        'GPT-5 is out',
      ]),
      field('Message #general'),
    ],
    [
      'Slack in the browser',
      page('https://app.slack.com/client/T1/C2', 'general - Slack', ['GPT-5 is out', 'New chat']),
      field('Message #general'),
    ],
    ['iMessage', appWin('com.apple.MobileSMS', 'Messages', ['Delivered']), field('iMessage')],
    [
      'WhatsApp Web',
      page('https://web.whatsapp.com/', 'WhatsApp', [
        { text: 'did you try claude?', align: 'right' },
      ]),
      field('Type a message'),
    ],
    [
      'an unknown messenger',
      page('https://chat.example.org/chat/room1', 'Room', [
        { text: 'see you at 5', align: 'right' },
        { text: 'ok!', align: 'left' },
      ]),
      field('Type a message'),
    ],
    [
      'a site search box',
      page('https://www.example.edu/', 'Example University', ['Ask anything about admissions']),
      field('Search…', { role: 'AXTextField', subrole: 'AXSearchField' }),
    ],
    [
      'Google search',
      page('https://www.google.com/search?q=gpt-5', 'gpt-5 - Google Search', [
        'AI Overview',
        'GPT-5',
      ]),
      field(null, { role: 'AXComboBox' }),
    ],
    [
      'VS Code chat pane',
      appWin('com.microsoft.VSCode', 'app.ts — dumbledore', ['GPT-5', 'Ask Copilot']),
      field('Ask Copilot'),
    ],
    [
      'Cursor',
      appWin('com.todesktop.230313mzl4w4u92', 'Cursor', ['Claude Sonnet 5', 'New chat']),
      field('Plan, search, build anything'),
    ],
    ['Terminal', appWin('com.apple.Terminal', 'zsh', ['$ claude', 'Opus 5.5']), field(null)],
  ])('%s', (_name, win, composer) => {
    expect(detectAssistant(win, composer)).toBeNull()
  })

  it('does not take a narrow or secure field for a composer', () => {
    expect(field('Ask anything', { frame: { x: 0, y: 0, width: 120, height: 20 } })).toBeNull()
    expect(field('Ask anything', { isSecure: true })).toBeNull()
    expect(field('Ask anything', { editable: false })).toBeNull()
  })
})
