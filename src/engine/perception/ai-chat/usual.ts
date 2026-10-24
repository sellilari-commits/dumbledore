/**
 * The student's usual AI chat, learned from use: every capture keeps where it came from (app,
 * URL, title), so the AI chats among recent captures, weighted by time spent and how recent
 * they are, say which assistant the student actually studies with. The app names that one when
 * no chat is open, and opens it (with the prompt, where the site supports it) to explore a gap.
 */
import type { Repos } from '@engine/contracts'
import type { Encounter } from '@shared/domain'
import { type AssistantConfig, assistantByKey, UNKNOWN_CHAT_KEY } from './assistants'
import { detectAssistant } from './detector'

/** How far back captures count. */
export const USUAL_WINDOW_DAYS = 45
/** A capture's weight halves every two weeks, so a switch of assistant shows within days. */
const HALF_LIFE_DAYS = 14
const DAY_MS = 86_400_000

type Capture = Pick<Encounter, 'source' | 'dwellSeconds' | 'createdAt'>

export function usualAssistant(
  captures: readonly Capture[],
  nowMs: number,
): AssistantConfig | null {
  const score = new Map<string, number>()
  for (const c of captures) {
    const match = detectAssistant({
      bundleId: c.source.bundleId ?? '',
      title: c.source.title,
      url: c.source.url,
    })
    const key = match?.assistant.key
    if (!key || key === UNKNOWN_CHAT_KEY) continue
    const ageDays = Math.max(0, (nowMs - Date.parse(c.createdAt)) / DAY_MS)
    const weight = Math.max(30, c.dwellSeconds) * 0.5 ** (ageDays / HALF_LIFE_DAYS)
    score.set(key, (score.get(key) ?? 0) + weight)
  }
  let best: string | null = null
  for (const [key, s] of score) if (best === null || s > (score.get(best) ?? 0)) best = key
  return best ? assistantByKey(best) : null
}

/** usualAssistant over the student's captures of the last USUAL_WINDOW_DAYS. */
export function usualAssistantFrom(
  repos: Pick<Repos, 'encounters'>,
  nowMs: number,
): AssistantConfig | null {
  const sinceIso = new Date(nowMs - USUAL_WINDOW_DAYS * DAY_MS).toISOString()
  return usualAssistant(repos.encounters.list({ sinceIso, limit: 500 }), nowMs)
}

/**
 * Sites that open a new chat with the prompt typed in but not sent. ChatGPT's and Perplexity's
 * `?q=` send it at once, and Dumbledore never sends for the student, so those just open.
 */
const PREFILL: Record<string, (prompt: string) => string> = {
  claude: (q) => `https://claude.ai/new?q=${encodeURIComponent(q)}`,
}

/** Where to open an assistant to explore a prompt: its site, prefilled when supported. */
export function assistantLink(
  a: AssistantConfig,
  prompt: string,
): { url: string; prefilled: boolean } | null {
  const prefill = PREFILL[a.key]
  if (prefill) return { url: prefill(prompt), prefilled: true }
  const site = a.sites[0]
  if (!site) return null
  return { url: `https://${site.host}${site.pathPrefix ?? '/'}`, prefilled: false }
}
