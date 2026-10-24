/**
 * Nudge wording (P11 nudge writer): Brain.writeNudge first, the candidate's template when the LLM
 * is slow, down, or breaks the rules — title ≤ 6 words, body ≤ 14 words with one call to action,
 * no echoed "key=value" facts.
 */
import type { Brain } from '@engine/brain-contract'
import type { NudgeKind } from '@shared/domain'

export const NUDGE_TITLE_MAX_WORDS = 6
export const NUDGE_BODY_MAX_WORDS = 14
const WRITE_TIMEOUT_MS = 5_000

export const wordCount = (s: string): number => s.trim().split(/\s+/).filter(Boolean).length

/** Trims to `max` words, adding "…" when something was cut. */
export function clampWords(s: string, max: number): string {
  const words = s.trim().split(/\s+/).filter(Boolean)
  return words.length <= max ? words.join(' ') : `${words.slice(0, max).join(' ')}…`
}

export const plural = (n: number, one: string, many = `${one}s`): string =>
  `${n} ${n === 1 ? one : many}`

function clean(s: string): string {
  return s
    .trim()
    .replace(/^["'“”‘’]+|["'“”‘’]+$/g, '')
    .replace(/\s+/g, ' ')
}

export function isValidNudgeText(title: string, body: string): boolean {
  const titleWords = wordCount(title)
  const bodyWords = wordCount(body)
  if (titleWords < 1 || titleWords > NUDGE_TITLE_MAX_WORDS) return false
  if (bodyWords < 1 || bodyWords > NUDGE_BODY_MAX_WORDS) return false
  if (/[=;{}[\]]/.test(`${title} ${body}`)) return false // echoed facts or JSON
  return (body.match(/\?/g) ?? []).length <= 1 // one call to action at most
}

export interface NudgeText {
  title: string
  body: string
  source: 'llm' | 'template'
}

export async function writeNudgeText(
  brain: Brain,
  input: {
    kind: NudgeKind
    facts: string
    language: string
    fallback: { title: string; body: string }
  },
  log?: (message: string, error?: unknown) => void,
): Promise<NudgeText> {
  try {
    const out = await brain.writeNudge(
      { kind: input.kind, facts: input.facts, language: input.language },
      { timeoutMs: WRITE_TIMEOUT_MS },
    )
    const title = clean(out.title)
    const body = clean(out.body)
    if (isValidNudgeText(title, body)) return { title, body, source: 'llm' }
  } catch (error) {
    log?.('nudge writer unavailable; using the template', error)
  }
  return { ...input.fallback, source: 'template' }
}
