/**
 * Decides whether a window is an AI chat and which assistant it is.
 *
 * Order of evidence: app bundle id → page URL → (only when the browser reports no URL) on-screen
 * text markers, or a title hint plus a generic marker. A page with a known, non-chat URL is never
 * classified from its text, so an article *about* ChatGPT is not a chat.
 */
import { hostMatches, parseUrl } from '../../privacy/url'
import type { WindowLike } from '../types'
import { ASSISTANTS, type AssistantConfig, GENERIC_CHAT_MARKERS } from './assistants'

export type DetectVia = 'bundle' | 'url' | 'text' | 'title_text'

export interface AssistantMatch {
  assistant: AssistantConfig
  via: DetectVia
}

/** UI strings are short; long lines are page content and never count as markers. */
const MAX_MARKER_LINE = 120

const norm = (s: string): string => s.toLowerCase().replace(/…/g, '...').replace(/\s+/g, ' ').trim()

const NORMALIZED = ASSISTANTS.map((a) => ({ assistant: a, markers: a.textMarkers.map(norm) }))
const GENERIC = GENERIC_CHAT_MARKERS.map(norm)

export function detectAssistant(
  win: Omit<WindowLike, 'pid' | 'windowId' | 'appName'>,
): AssistantMatch | null {
  const bundle = win.bundleId.toLowerCase()
  for (const assistant of ASSISTANTS) {
    if (assistant.bundleIds.some((id) => id.toLowerCase() === bundle))
      return { assistant, via: 'bundle' }
  }

  const url = parseUrl(win.url)
  if (url?.host) {
    for (const assistant of ASSISTANTS) {
      const hit = assistant.sites.some(
        (site) =>
          hostMatches(url.host, site.host) &&
          (!site.pathPrefix || url.path.toLowerCase().startsWith(site.pathPrefix.toLowerCase())),
      )
      if (hit) return { assistant, via: 'url' }
    }
    return null
  }

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
