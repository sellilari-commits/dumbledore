/**
 * P0 Triage (tier `triage`): the cheap first look at a window of the last few minutes. One
 * numbered list, one short excerpt per episode, and one yes/no per episode — "does it contain
 * learnable content?" — judged together, so a search, a page and an AI chat on the same topic
 * support each other. Only the "yes" episodes go on to the full extraction (P1).
 */
import type { TriageInput, TriageOutput } from '@engine/brain-contract'
import { z } from 'zod'
import { looksFinnish } from '../llm/text'
import { LEARNING } from './p01-extract'
import type { PromptSpec } from './shared'

export const LlmTriage = z.object({
  results: z.array(
    z.object({
      id: z.string(),
      hasLearnableContent: z.boolean(),
      reason: z.string(),
    }),
  ),
})
export type LlmTriage = z.infer<typeof LlmTriage>

const SYSTEM = `You triage a student's screen activity for a study coach. You get a numbered list of the episodes from the last few minutes (an episode is a stretch on one page or in one app), each with a short excerpt and behaviour signals. For each episode answer one question: does it contain learnable content?

${LEARNING}

Judge the episodes together: they come from one stretch of the student's time. A search, a page and an AI chat on the same topic support each other, so a short or terse episode next to clear study on the same topic is a yes. Menus, feeds, sign-in pages and navigation alone are a no. Dumbledore's own screens (this study coach) are a no.
Building or fixing one's own software with a coding agent or AI assistant (edits, builds, deploys, commits, test runs, "Ran a command", task lists, plans for an app) is work, not learning: a no, even when the AI explains steps, unless the student explicitly asks to understand a concept.
Highlighted text means yes when it is content (an explanation, a fact, a page); a highlight inside coding-agent work or in the student's own messages about building software is a no.

Answer for every episode, by its id, in input order: hasLearnableContent (true/false) and reason (≤ 10 words).`

function dwell(seconds: number): string {
  const s = Math.max(0, Math.round(seconds))
  return s >= 60 ? `${Math.floor(s / 60)}m${s % 60}s` : `${s}s`
}

function host(url: string | null): string | null {
  if (!url) return null
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`.slice(0, 80)
  } catch {
    return url.slice(0, 80)
  }
}

export function buildTriageUser(input: TriageInput): string {
  return input.episodes
    .map((ep, i) => {
      const head = [
        `${i + 1}. id=${ep.id}`,
        ep.kind,
        ep.app,
        ep.title ? `"${ep.title.slice(0, 100)}"` : null,
        host(ep.url),
        dwell(ep.dwellSeconds),
      ]
      const sig: string[] = []
      if (ep.signals.searches.length)
        sig.push(`searches=${JSON.stringify(ep.signals.searches.slice(0, 3))}`)
      if (ep.signals.aiQuestions.length)
        sig.push(`asked=${JSON.stringify(ep.signals.aiQuestions.slice(0, 3))}`)
      if (ep.signals.scrollBacks > 0) sig.push(`scrolled_back=${ep.signals.scrollBacks}`)
      const lines = [head.filter(Boolean).join(' · ') + (sig.length ? ` · ${sig.join(' · ')}` : '')]
      lines.push(`   excerpt: ${ep.excerpt.replace(/\s+/g, ' ').trim() || '(empty)'}`)
      const highlights = ep.signals.highlights ?? []
      if (highlights.length)
        lines.push(
          `   highlighted: ${highlights
            .slice(0, 3)
            .map((h) => `"${h.slice(0, 120)}"`)
            .join(' · ')}`,
        )
      return lines.join('\n')
    })
    .join('\n')
}

/** One answer per input episode, matched by id (then position); missing answers are null. */
export function finalizeTriage(out: LlmTriage, input: TriageInput): TriageOutput {
  return {
    results: input.episodes.map((ep, i) => {
      const r =
        out.results.find((x) => x.id.trim() === ep.id) ??
        (out.results[i] && !input.episodes.some((e) => e.id === out.results[i]?.id.trim())
          ? out.results[i]
          : undefined)
      return {
        id: ep.id,
        hasLearnableContent: r ? r.hasLearnableContent : null,
        reason: r?.reason.trim() ?? '',
      }
    }),
  }
}

export const triagePrompt: PromptSpec<TriageInput, LlmTriage, TriageOutput> = {
  id: 'P0',
  task: 'triage',
  version: 2,
  tier: 'triage',
  temperature: 0,
  maxOutputTokens: 1200,
  onDeviceMaxOutputTokens: 900,
  reasoningEffort: null,
  schemaName: 'triage',
  schema: LlmTriage,
  onDeviceOk: true,
  cacheable: true,
  language: (input) =>
    looksFinnish(input.episodes.map((e) => `${e.title ?? ''}\n${e.excerpt}`).join('\n'))
      ? 'fi'
      : 'en',
  build: (input) => ({ system: SYSTEM, user: buildTriageUser(input) }),
  finalize: finalizeTriage,
}
