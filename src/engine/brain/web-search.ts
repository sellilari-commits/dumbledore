/**
 * runWebSearch(): Brain.webSearch. One Gemini call with Google Search grounding, separate from
 * the chat loop, so Gemini's built-in search never mixes with the chat's function tools.
 *
 * - Goes through the router like every other call: the chat tier's Gemini routes only
 *   (CallPlan.providers), so the spend cap, rate limits, daily budgets, redaction and the usage
 *   log all apply (task 'webSearch'). Groq / OVH / Mistral / on-device have no search: no fallback.
 * - No Gemini key (the backend reports itself unavailable) → 'no-key', nothing is sent.
 * - Deadline 20 s by default (CallOptions.timeoutMs), abortable through CallOptions.signal.
 * - Answer clipped to ~120 words; sources deduped by URL, http(s) only, at most 6.
 *
 * Not counted: Google's per-query fee for grounding (billed per search, not per token), so the
 * spend cap only sees the tokens. The per-turn cap in the chat tool keeps searches few.
 */
import {
  type CallOptions,
  WEB_SEARCH_NO_KEY,
  type WebSearchNoKey,
  type WebSearchResult,
  type WebSearchSource,
} from '@engine/brain-contract'
import type { Clock } from '../clock'
import { InvalidOutputError, type Router } from './llm/router'
import { estimateMessagesTokens, looksFinnish } from './llm/text'
import { BackendError, type SourceLink } from './llm/types'

export const WEB_SEARCH_TIMEOUT_MS = 20_000
export const WEB_SEARCH_MAX_WORDS = 120
export const WEB_SEARCH_MAX_SOURCES = 6
const MAX_OUTPUT_TOKENS = 500

const SYSTEM = [
  'You answer one question for a student by searching the web with Google Search.',
  `Answer in at most ${WEB_SEARCH_MAX_WORDS - 20} words of plain text: the facts, with dates or numbers where they matter.`,
  'No markdown, no links or URLs in the text (the sources are shown separately).',
  'If the search finds nothing reliable, say so in one sentence instead of guessing.',
  'Answer in the language of the question.',
].join('\n')

export interface WebSearchDeps {
  router: Router
  clock: Clock
  /** True when the Gemini backend has a key (its availability()); false → 'no-key'. */
  geminiReady: () => Promise<boolean>
}

/** At most `max` words, "…" when cut. */
export function clipWords(text: string, max = WEB_SEARCH_MAX_WORDS): string {
  const words = text.replace(/\s+/g, ' ').trim().split(' ').filter(Boolean)
  if (words.length <= max) return words.join(' ')
  return `${words
    .slice(0, max)
    .join(' ')
    .replace(/[,;:.!?]+$/, '')}…`
}

/** http(s) URL, else null. */
export function webUrl(raw: string): string | null {
  try {
    const u = new URL(raw.trim())
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.toString() : null
  } catch {
    return null
  }
}

/** Deduped by URL, http(s) only, titles cleaned (host when missing), at most `max`. */
export function cleanSources(
  raw: readonly SourceLink[] | undefined,
  max = WEB_SEARCH_MAX_SOURCES,
): WebSearchSource[] {
  const out: WebSearchSource[] = []
  const seen = new Set<string>()
  for (const s of raw ?? []) {
    const url = webUrl(s.url)
    if (!url || seen.has(url)) continue
    seen.add(url)
    const title = s.title.replace(/\s+/g, ' ').trim().slice(0, 120) || new URL(url).hostname
    out.push({ title, url })
    if (out.length >= max) break
  }
  return out
}

export async function runWebSearch(
  deps: WebSearchDeps,
  query: string,
  opts?: CallOptions,
): Promise<WebSearchResult | WebSearchNoKey> {
  const q = query.replace(/\s+/g, ' ').trim()
  if (!q) return { answer: '', sources: [] }
  if (!(await deps.geminiReady())) return WEB_SEARCH_NO_KEY
  const messages = [{ role: 'user' as const, content: q }]
  const finnish = looksFinnish(q)
  return deps.router.run(
    {
      task: 'webSearch',
      tier: 'chat',
      providers: ['gemini'],
      deadline: deps.clock.now() + (opts?.timeoutMs ?? WEB_SEARCH_TIMEOUT_MS),
      signal: opts?.signal,
      estimatedTokens: estimateMessagesTokens(SYSTEM, messages) + MAX_OUTPUT_TOKENS,
      outputTokens: MAX_OUTPUT_TOKENS,
      language: finnish ? 'fi' : 'en',
      onDeviceOk: false,
    },
    async (attempt) => {
      // The plan allows Gemini only; never let a model without search answer from memory.
      if (attempt.route.provider !== 'gemini') {
        throw new BackendError('unavailable', 'no web search on this provider')
      }
      const res = await attempt.call({
        system: SYSTEM,
        messages,
        output: { kind: 'text' },
        temperature: 0.3,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        reasoningEffort: 'low',
        grounding: 'web_search',
      })
      const answer = clipWords(res.text)
      if (!answer) throw new InvalidOutputError('empty web search answer')
      return { answer, sources: cleanSources(res.sources) }
    },
  )
}
