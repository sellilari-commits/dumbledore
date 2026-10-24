/**
 * Decides whether a window is an AI chat and which assistant it is.
 *
 * Order of evidence:
 *   0. coding sessions are never study chats (editors, terminals, claude.ai/code, and a chat
 *      app whose screen shows a coding agent at work — see `coding.ts`);
 *   1. app bundle id (apps that are only partly a chat also need their chat window's title);
 *   2. page URL of a known assistant site;
 *   3. the focused composer's placeholder naming an assistant ("Message Copilot" in a sidebar);
 *   4. only when the browser reports no URL: on-screen text markers, or a title hint plus a
 *      generic marker;
 *   5. an unknown chat: a focused composer plus AI evidence on screen (`composer.ts`), never in
 *      email, messaging, documents, search or code (`non-chat.ts`).
 * A page with a URL is never classified from page text alone, so an article *about* ChatGPT is
 * not a chat.
 */
import { hostMatches, parseUrl } from '../../privacy/url'
import type { WindowLike } from '../types'
import {
  ASSISTANTS,
  type AssistantConfig,
  type AssistantSite,
  GENERIC_CHAT_MARKERS,
  UNKNOWN_CHAT,
} from './assistants'
import { isCodingApp, isCodingSite, looksLikeCodingSession } from './coding'
import {
  assistantByPlaceholder,
  type ComposerHint,
  chatEvidence,
  isUnknownChat,
  norm,
} from './composer'
import { isNonChatApp, isNonChatHost } from './non-chat'

export type DetectVia = 'bundle' | 'url' | 'text' | 'title_text' | 'composer'

export interface AssistantMatch {
  assistant: AssistantConfig
  via: DetectVia
}

export interface Detection {
  match: AssistantMatch | null
  /** A coding agent is on screen: not a study chat, even in a chat app. */
  coding: boolean
}

type DetectWindow = Omit<WindowLike, 'pid' | 'windowId' | 'appName'>

/** UI strings are short; long lines are page content and never count as markers. */
const MAX_MARKER_LINE = 120

const NORMALIZED = ASSISTANTS.map((a) => ({ assistant: a, markers: a.textMarkers.map(norm) }))
const GENERIC = GENERIC_CHAT_MARKERS.map(norm)

export function detectAssistant(
  win: DetectWindow,
  composer: ComposerHint | null = null,
): AssistantMatch | null {
  return detectChat(win, composer).match
}

export function detectChat(win: DetectWindow, composer: ComposerHint | null = null): Detection {
  const lines = win.lines ?? []
  if (
    isCodingApp(win.bundleId) ||
    isCodingSite(win.url) ||
    looksLikeCodingSession(
      lines.map((l) => l.text),
      win.title,
    )
  ) {
    return { match: null, coding: true }
  }
  return { match: detectKnownOrUnknown(win, composer), coding: false }
}

function detectKnownOrUnknown(
  win: DetectWindow,
  composer: ComposerHint | null,
): AssistantMatch | null {
  const bundle = win.bundleId.toLowerCase()
  const title = win.title ?? ''
  for (const assistant of ASSISTANTS) {
    if (!assistant.bundleIds.some((id) => id.toLowerCase() === bundle)) continue
    if (!assistant.bundleTitle || assistant.bundleTitle.test(title) || composer)
      return { assistant, via: 'bundle' }
  }

  const url = parseUrl(win.url)
  if (url?.host) {
    for (const assistant of ASSISTANTS) {
      if (assistant.sites.some((site) => siteMatches(site, url))) return { assistant, via: 'url' }
    }
  }

  const named = composer ? assistantByPlaceholder(composer.placeholder) : null
  if (named && !isNonChatApp(win.bundleId)) return { assistant: named, via: 'composer' }

  if (!url?.host) {
    const byText = detectByText(win)
    if (byText) return byText
  }

  if (composer && !isNonChatApp(win.bundleId) && !isNonChatHost(win.url)) {
    const evidence = chatEvidence({
      placeholder: composer.placeholder,
      lines: (win.lines ?? []).map((l) => ({ text: l.text, align: l.align ?? null })),
      title: win.title,
      url: win.url,
    })
    if (isUnknownChat(composer, evidence)) return { assistant: UNKNOWN_CHAT, via: 'composer' }
  }
  return null
}

function siteMatches(site: AssistantSite, url: NonNullable<ReturnType<typeof parseUrl>>): boolean {
  if (!hostMatches(url.host, site.host)) return false
  if (site.pathPrefix && !url.path.toLowerCase().startsWith(site.pathPrefix.toLowerCase()))
    return false
  return !site.param || url.params.get(site.param[0]) === site.param[1]
}

function detectByText(win: DetectWindow): AssistantMatch | null {
  const lines = (win.lines ?? [])
    .map((l) => l.text)
    .filter((t) => t.length <= MAX_MARKER_LINE)
    .map(norm)
  if (lines.length === 0) return null
  for (const { assistant, markers } of NORMALIZED) {
    if (lines.some((line) => markers.some((m) => line.includes(m))))
      return { assistant, via: 'text' }
  }
  const title = win.title ?? ''
  const hasGeneric = lines.some((line) => GENERIC.some((m) => line.includes(m)))
  if (hasGeneric) {
    const assistant = ASSISTANTS.find((a) => a.titleMarker.test(title))
    if (assistant) return { assistant, via: 'title_text' }
  }
  return null
}
