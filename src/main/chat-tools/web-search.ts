/**
 * Chat tool `web_search`: looks something up on the web for the double-tap chat. The search is
 * its own Gemini call with Google Search grounding (Brain.webSearch), never mixed with the chat's
 * function tools. Read-only: no receipts, no Undo, nothing opened; the sources are only shown as
 * links under the reply (sourcesMarkdown), opened only when the student clicks one.
 *
 * Wiring (the registry / ask flow):
 *   const web = createWebSearchTool({
 *     search: (q, signal) => brain.webSearch ? brain.webSearch(q, { signal }) : Promise.resolve('no-key'),
 *   })
 *   tools.push(web.tool)
 *   // at the start of every chat turn (each student message):
 *   web.resetTurn()
 *   // after the loop answered: links under the reply
 *   const links = sourcesMarkdown(web.turnSources())
 * At most `maxPerTurn` (default 3) searches per turn; more get a failure telling the model to
 * answer with what it has.
 */
import type { WebSearchNoKey, WebSearchResult, WebSearchSource } from '@engine/brain-contract'
import { z } from 'zod'
import { type ChatTool, defineTool, failure, outcome, short } from './types'

export const WEB_SEARCH_PER_TURN = 3
export const NO_KEY_MESSAGE = 'Web search needs a Gemini key in Settings → AI providers.'

export const WebSearchInput = z.object({
  query: z
    .string()
    .min(2)
    .max(300)
    .describe('What to look up, as a short search question in the language of the chat.'),
})
export type WebSearchInput = z.infer<typeof WebSearchInput>

export const WEB_SEARCH_DESCRIPTION = [
  'Search the web (Google) and get a short answer with its sources.',
  "Use it for facts outside the student's own Dumbledore data (current events, definitions, dates, numbers, documentation) or when the student asks you to look something up.",
  "For anything about the student's own studies (subjects, notes, roadmaps, quizzes, gaps) use read/search instead, never the web.",
  `At most ${WEB_SEARCH_PER_TURN} searches per message. Returns { answer, sources: [{ title, url }] }.`,
  'Cite what you use by its source title; the chat shows the sources as links under your reply. Never open a link or call act to open a page: links open only when the student clicks them.',
].join(' ')

export interface WebSearchToolDeps {
  /** Brain.webSearch; 'no-key' when there is no Gemini key. May throw (timeout, unavailable). */
  search: (query: string, signal?: AbortSignal) => Promise<WebSearchResult | WebSearchNoKey>
  /** Searches allowed per chat turn (default 3). */
  maxPerTurn?: number
}

export interface WebSearchTool {
  tool: ChatTool<WebSearchInput>
  /** Call at the start of every chat turn: resets the count and the turn's sources. */
  resetTurn(): void
  /** Every source the searches of this turn returned, deduped by URL, in order. */
  turnSources(): WebSearchSource[]
}

/** http(s) URL, else null. */
function webUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

function errorLine(err: unknown): string {
  const e = err as Error | undefined
  if (e?.name === 'AbortError') return 'Web search was cancelled.'
  if (e?.name === 'BrainTimeoutError') return 'Web search took too long; answer without it.'
  if (/over-budget/.test(e?.message ?? '')) {
    return 'Web search is off: the AI spend cap is reached (Settings → AI providers).'
  }
  return 'Web search is unavailable right now; answer without it.'
}

export function createWebSearchTool(deps: WebSearchToolDeps): WebSearchTool {
  const max = deps.maxPerTurn ?? WEB_SEARCH_PER_TURN
  let used = 0
  let sources: WebSearchSource[] = []

  const tool = defineTool({
    name: 'web_search',
    description: WEB_SEARCH_DESCRIPTION,
    input: WebSearchInput,
    async run(input, ctx) {
      const query = input.query.replace(/\s+/g, ' ').trim()
      if (query.length < 2) return failure('Give a search question.')
      if (used >= max) {
        return failure(
          `Search limit reached for this message (${max}). Answer with what you found so far.`,
        )
      }
      used += 1
      let res: WebSearchResult | WebSearchNoKey
      try {
        res = await deps.search(query, ctx.signal)
      } catch (err) {
        return failure(errorLine(err))
      }
      if (res === 'no-key') {
        used -= 1 // nothing was searched
        return failure(NO_KEY_MESSAGE)
      }
      const found: WebSearchSource[] = []
      for (const s of res.sources) {
        const url = webUrl(s.url)
        if (url) found.push({ title: short(s.title, 100) || new URL(url).hostname, url })
      }
      for (const s of found) {
        if (!sources.some((x) => x.url === s.url)) sources.push(s)
      }
      return outcome({ answer: res.answer, sources: found })
    },
  })

  return {
    tool,
    resetTurn() {
      used = 0
      sources = []
    },
    turnSources: () => [...sources],
  }
}

/** Markdown link text: brackets and backslashes escaped, one line. */
function linkText(title: string): string {
  return short(title, 80).replace(/[\\[\]]/g, (c) => `\\${c}`)
}

/** Markdown link target: parentheses, spaces and angle brackets percent-encoded. */
function linkTarget(url: string): string {
  return url.replace(/[()<> ]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
}

/**
 * "Sources: [title](url) · [title](url)" for under the reply; http(s) URLs only, deduped;
 * '' when there are none.
 */
export function sourcesMarkdown(list: readonly WebSearchSource[]): string {
  const seen = new Set<string>()
  const links: string[] = []
  for (const s of list) {
    const url = webUrl(s.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    links.push(`[${linkText(s.title) || new URL(url).hostname}](${linkTarget(url)})`)
  }
  return links.length ? `Sources: ${links.join(' · ')}` : ''
}
