/**
 * Known AI chat assistants with a web app (and, where one exists, their desktop app).
 *
 * Sources, checked 2026-10-24: hosts by loading each site (title + final URL after redirects);
 * bundle ids from Homebrew cask uninstall/zap stanzas (formulae.brew.sh/api/cask/<token>.json),
 * the App Store lookup API (itunes.apple.com/lookup) or `mdls` on an installed app.
 * Notable: the current ChatGPT app is `com.openai.codex` (cask "chatgpt" 26.x); `com.openai.chat`
 * is "ChatGPT Classic". NotebookLM now redirects to notebook.google.com ("Gemini Notebook").
 */
import { ASSISTANT_NAMES } from '@shared/llm'
import type { AssistantConfig } from './assistants'

export const WEB_ASSISTANTS: readonly AssistantConfig[] = [
  {
    key: 'chatgpt',
    name: ASSISTANT_NAMES.chatgpt,
    bundleIds: ['com.openai.codex', 'com.openai.chat'], // ChatGPT app, ChatGPT Classic (casks)
    sites: [{ host: 'chatgpt.com' }, { host: 'chat.openai.com' }],
    textMarkers: ['Message ChatGPT', 'ChatGPT can make mistakes', 'Ask ChatGPT'],
    titleMarker: /\bChatGPT\b/i,
    placeholders: ['Ask anything', 'Message ChatGPT', 'Ask ChatGPT'],
    userAlign: 'right',
  },
  {
    key: 'claude',
    name: ASSISTANT_NAMES.claude,
    bundleIds: ['com.anthropic.claudefordesktop'], // mdls + cask "claude"
    sites: [{ host: 'claude.ai' }],
    textMarkers: [
      'Reply to Claude',
      'Claude can make mistakes',
      'Talk with Claude',
      'Write your prompt to Claude',
    ],
    titleMarker: /\bClaude\b/i,
    placeholders: [
      'Reply to Claude…',
      'Reply to Claude...',
      'How can I help you today?',
      'Write your prompt to Claude',
    ],
    userAlign: null,
  },
  {
    key: 'gemini',
    name: ASSISTANT_NAMES.gemini,
    bundleIds: ['com.google.GeminiMacOS'], // cask "google-gemini"
    sites: [
      { host: 'gemini.google.com' },
      { host: 'aistudio.google.com' },
      { host: 'bard.google.com' },
    ],
    textMarkers: ['Ask Gemini', 'Gemini can make mistakes', 'Gemini may display inaccurate info'],
    titleMarker: /\b(Gemini|Google AI Studio)\b/i,
    placeholders: ['Ask Gemini', 'Enter a prompt here', 'Start typing a prompt', 'Type something'],
    userAlign: 'right',
  },
  {
    key: 'perplexity',
    name: ASSISTANT_NAMES.perplexity,
    // cask "perplexity" (current app); ai.perplexity.mac: the earlier App Store build
    bundleIds: ['ai.perplexity.macv3', 'ai.perplexity.mac'],
    sites: [{ host: 'perplexity.ai' }],
    textMarkers: ['Ask a follow-up', 'Ask follow-up', 'Perplexity can make mistakes'],
    titleMarker: /\bPerplexity\b/i,
    placeholders: ['Ask anything…', 'Ask anything...', 'Ask a follow-up…', 'Ask follow-up'],
    userAlign: null,
  },
  {
    key: 'copilot',
    name: ASSISTANT_NAMES.copilot,
    // App Store lookup id6738511300; Microsoft 365 Copilot (cask "microsoft-365-copilot")
    bundleIds: ['com.microsoft.copilot-mac', 'com.microsoft.m365copilot'],
    sites: [
      { host: 'copilot.microsoft.com' },
      { host: 'm365.cloud.microsoft', pathPrefix: '/chat' },
    ],
    textMarkers: ['Message Copilot', 'Copilot may make mistakes'],
    titleMarker: /\bCopilot\b/i,
    placeholders: ['Message Copilot', 'Ask me anything'],
    userAlign: 'right',
  },
  {
    key: 'mistral',
    name: ASSISTANT_NAMES.mistral,
    bundleIds: [], // no macOS app found (casks, App Store)
    sites: [{ host: 'chat.mistral.ai' }],
    textMarkers: ['Ask Le Chat', 'Le Chat can make mistakes'],
    titleMarker: /\bLe Chat\b/i,
    placeholders: ['Ask Le Chat or @mention an agent', 'Ask Le Chat', 'Ask anything'],
    userAlign: 'right',
  },
  {
    key: 'deepseek',
    name: ASSISTANT_NAMES.deepseek,
    bundleIds: [], // no official macOS app found
    sites: [{ host: 'chat.deepseek.com' }],
    textMarkers: ['Message DeepSeek', 'AI-generated, for reference only'],
    titleMarker: /\bDeepSeek\b/i,
    placeholders: ['Message DeepSeek'],
    userAlign: 'right',
  },
  {
    key: 'grok',
    name: ASSISTANT_NAMES.grok,
    bundleIds: [], // no macOS app found
    sites: [{ host: 'grok.com' }, { host: 'x.com', pathPrefix: '/i/grok' }],
    textMarkers: ['Ask Grok', 'How can Grok help?'],
    titleMarker: /\bGrok\b/i,
    placeholders: ['How can Grok help?', 'Ask Grok', 'Ask anything'],
    userAlign: 'right',
  },
  web('meta', 'Meta AI', [{ host: 'meta.ai' }], /\bMeta AI\b/i, ['Ask Meta AI']),
  web('poe', 'Poe', [{ host: 'poe.com' }], /\bPoe\b/, [], ['com.quora.poe.electron']),
  web(
    'huggingchat',
    'HuggingChat',
    [{ host: 'huggingface.co', pathPrefix: '/chat' }],
    /\bHuggingChat\b/i,
    [],
    ['cyrilzakka.HuggingChat-Mac'],
  ),
  web(
    'kimi',
    'Kimi',
    [{ host: 'kimi.com' }, { host: 'kimi.moonshot.cn' }],
    /\bKimi\b/i,
    [],
    ['com.moonshot.kimichat'],
  ),
  web(
    'qwen',
    'Qwen',
    [{ host: 'chat.qwen.ai' }, { host: 'qianwen.com' }, { host: 'tongyi.com' }],
    /\b(Qwen|千问)/i,
    [],
    ['com.alibaba.tongyi'],
  ),
  web('phind', 'Phind', [{ host: 'phind.com' }], /\bPhind\b/i),
  web('you', 'You.com', [{ host: 'you.com' }], /\bYou\.com\b/i),
  web(
    'notebooklm',
    'NotebookLM',
    [{ host: 'notebooklm.google.com' }, { host: 'notebook.google.com' }],
    /\b(NotebookLM|Gemini Notebook)\b/i,
  ),
  web(
    'google-ai-mode',
    'Google AI Mode',
    [
      { host: 'google.com', pathPrefix: '/search', param: ['udm', '50'] },
      { host: 'google.com', pathPrefix: '/ai' },
    ],
    /\bAI Mode\b/,
  ),
  web('duck-ai', 'Duck.ai', [{ host: 'duck.ai' }], /\bDuck\.ai\b/i),
  web('github-copilot', 'GitHub Copilot', [{ host: 'github.com', pathPrefix: '/copilot' }], /(?!)/),
  web('openrouter', 'OpenRouter', [{ host: 'openrouter.ai', pathPrefix: '/chat' }], /(?!)/),
  web('arena', 'LMArena', [{ host: 'arena.ai' }, { host: 'lmarena.ai' }], /\bLMArena\b/i),
  web('pi', 'Pi', [{ host: 'pi.ai' }], /(?!)/),
  web('character-ai', 'Character.AI', [{ host: 'character.ai' }], /\bCharacter\.AI\b/i),
  web('t3-chat', 'T3 Chat', [{ host: 't3.chat' }], /\bT3 Chat\b/i),
  web(
    'z-ai',
    'Z.ai',
    [{ host: 'chat.z.ai' }, { host: 'chatglm.cn' }],
    /\b(Z\.ai|ChatGLM)\b/i,
    [],
    ['com.zhipu.chatglm'],
  ),
  web(
    'doubao',
    'Doubao',
    [{ host: 'doubao.com', pathPrefix: '/chat' }],
    /(豆包|Doubao)/i,
    [],
    ['com.bot.pc.doubao'],
  ),
  web(
    'yuanbao',
    'Yuanbao',
    [{ host: 'yuanbao.tencent.com' }],
    /(元宝|Yuanbao)/i,
    [],
    ['com.tencent.yuanbao'],
  ),
]

/** A web-first assistant: no reliable layout cue, markers only when the text is its own. */
function web(
  key: string,
  name: string,
  sites: AssistantConfig['sites'],
  titleMarker: RegExp,
  textMarkers: readonly string[] = [],
  bundleIds: readonly string[] = [],
): AssistantConfig {
  return {
    key,
    name,
    bundleIds,
    sites,
    textMarkers,
    titleMarker,
    placeholders: textMarkers,
    userAlign: null,
  }
}
