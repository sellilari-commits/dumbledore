/**
 * Episode identity: one episode per app + window + page (URL, or the window title for apps
 * without URLs), plus the small rules around it (title clean-up, "new chat" → conversation URL
 * continuity, which apps count as reading apps).
 */
import { pageIdentity, parseUrl } from '../../privacy/url'
import { type WindowLike, windowKey } from '../types'

/** Strips unread counters, "Edited" markers and page indicators that change while reading. */
export function normalizeTitle(title: string | null): string {
  if (!title) return ''
  return title
    .replace(/^\(\d+\+?\)\s*/, '')
    .replace(/\s+[—–-]\s+(Edited|Muokattu|Redigerad)$/i, '')
    .replace(/\s*[(—–-]?\s*(page|sivu|sida)\s+\d+\s*(of|\/|av)\s*\d+\)?/gi, '')
    .replace(/\s+[—–-]\s+(Google Chrome|Safari|Firefox|Microsoft Edge|Brave|Arc)$/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

export function pageKeyOf(win: Pick<WindowLike, 'bundleId' | 'url' | 'title'>): string {
  if (win.url && parseUrl(win.url)) return pageIdentity(win.url)
  return `${win.bundleId}|${normalizeTitle(win.title)}`
}

export function episodeKeyOf(win: WindowLike): { key: string; windowKey: string; pageKey: string } {
  const wk = windowKey(win)
  const pageKey = pageKeyOf(win)
  return { key: `${wk}|${pageKey}`, windowKey: wk, pageKey }
}

const NEW_CHAT_PATHS = new Set(['/', '/new', '/app', '/chat', '/chats', '/a/chat'])

/**
 * True when an AI chat moved from its "new chat" page to the conversation it just created
 * (chatgpt.com/ → chatgpt.com/c/…, claude.ai/new → claude.ai/chat/…): same episode.
 */
export function continuesChat(prevUrl: string | null, nextUrl: string | null): boolean {
  const a = parseUrl(prevUrl)
  const b = parseUrl(nextUrl)
  if (!a?.host || !b?.host || a.host !== b.host) return false
  const prev = a.path.replace(/\/+$/, '') || '/'
  return NEW_CHAT_PATHS.has(prev) || b.path.startsWith(`${prev}/`)
}

const READING_APPS = new Set(
  [
    'com.apple.Preview',
    'com.adobe.Acrobat.Pro',
    'com.adobe.Reader',
    'net.sourceforge.skim-app.skim',
    'com.readdle.PDFExpert-Mac',
    'com.apple.iBooksX',
    'com.amazon.Kindle',
    'com.amazon.Lassen',
    'com.microsoft.Word',
    'com.microsoft.Powerpoint',
    'com.apple.iWork.Pages',
    'com.apple.iWork.Keynote',
    'notion.id',
    'md.obsidian',
    'com.apple.Notes',
    'net.ankiweb.dtop',
    'org.zotero.zotero',
  ].map((s) => s.toLowerCase()),
)

export function isReadingApp(bundleId: string): boolean {
  return READING_APPS.has(bundleId.toLowerCase())
}

export function isPdf(url: string | null, title: string | null): boolean {
  const p = parseUrl(url)
  if (p && /\.pdf$/i.test(p.path)) return true
  return !!title && /\.pdf\b/i.test(title)
}
