/**
 * The AI chat assistants Dumbledore recognises: apps, sites, on-screen text markers and the chat
 * input placeholders handed to helper `ax.findChatInput` (docs/PLAN.md R29, §5.3 F2).
 *
 * The catalog lives in `catalog-web.ts` (assistants with a web app, plus their desktop apps) and
 * `catalog-apps.ts` (desktop and local-model apps). Every host and bundle id there was checked
 * (Homebrew cask metadata, the App Store lookup API, `mdls` on installed apps, live page titles);
 * see docs/progress/W-all-chats.md. Chats that match no entry are recognised by their composer
 * (`composer.ts`) and reported as the generic `UNKNOWN_CHAT`.
 */
import { APP_ASSISTANTS } from './catalog-apps'
import { WEB_ASSISTANTS } from './catalog-web'

export interface AssistantSite {
  host: string // hostMatches syntax: the host and its subdomains
  pathPrefix?: string
  /** A query parameter the URL must carry, e.g. Google Search's AI Mode (`udm=50`). */
  param?: readonly [name: string, value: string]
}

export interface AssistantConfig {
  /** "chatgpt", "claude", …; the eight keys of ASSISTANT_NAMES keep their meaning. */
  key: string
  name: string
  bundleIds: readonly string[]
  /** For apps that are only partly a chat (Raycast): the window title that marks a chat window. */
  bundleTitle?: RegExp
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

export const UNKNOWN_CHAT_KEY = 'ai_chat'

/** An AI chat recognised by its composer and screen, not by a catalog entry. */
export const UNKNOWN_CHAT: AssistantConfig = {
  key: UNKNOWN_CHAT_KEY,
  name: 'AI chat',
  bundleIds: [],
  sites: [],
  textMarkers: [],
  titleMarker: /(?!)/,
  placeholders: [],
  userAlign: null,
}

export const ASSISTANTS: readonly AssistantConfig[] = [...WEB_ASSISTANTS, ...APP_ASSISTANTS]

export function assistantByKey(key: string): AssistantConfig | null {
  if (key === UNKNOWN_CHAT_KEY) return UNKNOWN_CHAT
  return ASSISTANTS.find((a) => a.key === key) ?? null
}

/** Placeholders to pass to `ax.findChatInput`: the assistant's own, then the generic ones. */
export function chatInputPlaceholders(key?: string | null): string[] {
  const own = key
    ? (assistantByKey(key)?.placeholders ?? [])
    : ASSISTANTS.flatMap((a) => a.placeholders)
  return [...new Set([...own, ...GENERIC_CHAT_MARKERS])]
}
