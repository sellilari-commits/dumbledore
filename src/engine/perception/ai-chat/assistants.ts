/**
 * The AI chat assistants Dumbledore recognises: apps, sites, on-screen text markers and the chat
 * input placeholders handed to helper `ax.findChatInput` (docs/PLAN.md R29, §5.3 F2).
 *
 * Bundle ids marked "unverified" are best guesses for apps not installed on the dev Mac; sites
 * and text markers carry detection for them anyway.
 */
import { ASSISTANT_NAMES, type AssistantKey } from '@shared/llm'

export interface AssistantSite {
  host: string // hostMatches syntax: the host and its subdomains
  pathPrefix?: string
}

export interface AssistantConfig {
  key: AssistantKey
  name: string
  bundleIds: readonly string[]
  sites: readonly AssistantSite[]
  /** Text only this assistant shows (input placeholder, disclaimer); decisive on its own. */
  textMarkers: readonly string[]
  /** Window-title hint for browsers that don't report a URL. */
  titleMarker: RegExp
  /** Placeholders of the chat input, most specific first. */
  placeholders: readonly string[]
  /** Where the student's own messages sit; null when the layout gives no reliable cue. */
  userAlign: 'right' | null
}

/** Shared by several assistants; only counts together with a title hint. */
export const GENERIC_CHAT_MARKERS: readonly string[] = [
  'Ask anything',
  'What can I help with?',
  'How can I help you today?',
  'Ask me anything',
  'What do you want to know?',
]

export const ASSISTANTS: readonly AssistantConfig[] = [
  {
    key: 'chatgpt',
    name: ASSISTANT_NAMES.chatgpt,
    bundleIds: ['com.openai.chat'],
    sites: [{ host: 'chatgpt.com' }, { host: 'chat.openai.com' }],
    textMarkers: ['Message ChatGPT', 'ChatGPT can make mistakes', 'Ask ChatGPT'],
    titleMarker: /\bChatGPT\b/i,
    placeholders: ['Ask anything', 'Message ChatGPT', 'Ask ChatGPT'],
    userAlign: 'right',
  },
  {
    key: 'claude',
    name: ASSISTANT_NAMES.claude,
    bundleIds: ['com.anthropic.claudefordesktop'],
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
    bundleIds: ['com.google.GeminiMacOS', 'com.google.Gemini'], // unverified
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
    bundleIds: ['ai.perplexity.mac', 'ai.perplexity.app'], // unverified
    sites: [{ host: 'perplexity.ai' }],
    textMarkers: ['Ask a follow-up', 'Ask follow-up', 'Perplexity can make mistakes'],
    titleMarker: /\bPerplexity\b/i,
    placeholders: ['Ask anything…', 'Ask anything...', 'Ask a follow-up…', 'Ask follow-up'],
    userAlign: null,
  },
  {
    key: 'copilot',
    name: ASSISTANT_NAMES.copilot,
    bundleIds: ['com.microsoft.copilot', 'com.microsoft.CopilotForMac'], // unverified
    sites: [{ host: 'copilot.microsoft.com' }],
    textMarkers: ['Message Copilot', 'Copilot may make mistakes'],
    titleMarker: /\bCopilot\b/i,
    placeholders: ['Message Copilot', 'Ask me anything'],
    userAlign: 'right',
  },
  {
    key: 'mistral',
    name: ASSISTANT_NAMES.mistral,
    bundleIds: ['ai.mistral.chat', 'ai.mistral.lechat'], // unverified
    sites: [{ host: 'chat.mistral.ai' }],
    textMarkers: ['Ask Le Chat', 'Le Chat can make mistakes'],
    titleMarker: /\bLe Chat\b/i,
    placeholders: ['Ask Le Chat or @mention an agent', 'Ask Le Chat', 'Ask anything'],
    userAlign: 'right',
  },
  {
    key: 'deepseek',
    name: ASSISTANT_NAMES.deepseek,
    bundleIds: ['com.deepseek.chat'], // unverified
    sites: [{ host: 'chat.deepseek.com' }],
    textMarkers: ['Message DeepSeek', 'AI-generated, for reference only'],
    titleMarker: /\bDeepSeek\b/i,
    placeholders: ['Message DeepSeek'],
    userAlign: 'right',
  },
  {
    key: 'grok',
    name: ASSISTANT_NAMES.grok,
    bundleIds: ['ai.x.grok', 'ai.x.GrokApp'], // unverified
    sites: [{ host: 'grok.com' }, { host: 'x.com', pathPrefix: '/i/grok' }],
    textMarkers: ['Ask Grok', 'How can Grok help?'],
    titleMarker: /\bGrok\b/i,
    placeholders: ['How can Grok help?', 'Ask Grok', 'Ask anything'],
    userAlign: 'right',
  },
]

export function assistantByKey(key: string): AssistantConfig | null {
  return ASSISTANTS.find((a) => a.key === key) ?? null
}

/** Placeholders to pass to `ax.findChatInput`: the assistant's own, then the generic ones. */
export function chatInputPlaceholders(key?: string | null): string[] {
  const own = key
    ? (assistantByKey(key)?.placeholders ?? [])
    : ASSISTANTS.flatMap((a) => a.placeholders)
  return [...new Set([...own, ...GENERIC_CHAT_MARKERS])]
}
