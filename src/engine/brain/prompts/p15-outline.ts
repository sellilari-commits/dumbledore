/**
 * P15 Outline (tier `extract`): the student is reading a page (PDF, article) and asked Dumbledore
 * to outline it. Given the page as numbered lines and the subject's goal, gaps, mastered concepts
 * and open questions, mark which passages to READ carefully (they teach a gap, answer an open
 * question or serve the goal), which to SKIM (useful background) and which to SKIP (already
 * known, or off the goal). Code then cleans the ranges: in page order, within the page, no
 * overlaps, a short reason each.
 */
import { type OutlineInput, OutlineOutput } from '@engine/brain-contract'
import { looksFinnish } from '../llm/text'
import { bullets, languageName, type PromptSpec, tag } from './shared'

/** Lines sent per call; a longer page is outlined from its top (what is on screen first). */
export const OUTLINE_MAX_LINES = 400

export function outlineLanguage(input: OutlineInput): string {
  if (input.language && input.language !== 'auto') return input.language.slice(0, 2)
  return looksFinnish(input.lines.map((l) => l.text).join('\n')) ? 'fi' : 'en'
}

function system(lang: string): string {
  return `A student is reading the page below and asked you to outline what they need to read.
Mark passages as line ranges ("from" and "to" are the numbers in <page>, inclusive):
- read: teaches one of their gaps, answers one of their open questions, or is core to their goal. Be selective: usually 10–30% of the page.
- skim: useful background or examples for the goal, but not where their gaps are.
- skip: what they already know (<known>), or off their goal (navigation, references, unrelated sections).
Leave a line out of every range when it needs no mark.
Never mark as read or skim: the page title, navigation, menus, tabs, a table of contents, settings or appearance panels, buttons, image captions, references, citations, footnotes, "See also" or "External links". Mark only the article's own text.
Ranges are in page order and never overlap. Each "why" is at most 8 words and concrete ("Your gap: carbocation stability", "You know SN2 already", "Off topic: history of the method").
"summary": one sentence on what this page gives the student for their goal.
Write "why" and "summary" in ${languageName(lang)}.`
}

function user(input: OutlineInput): string {
  const lines = input.lines.slice(0, OUTLINE_MAX_LINES).map((l) => `${l.i}: ${l.text}`)
  return [
    tag(
      'subject',
      `${input.subject.name}${input.subject.goal ? ` — goal: ${input.subject.goal}` : ''}`,
    ),
    tag(
      'gaps',
      input.gaps.length
        ? bullets(input.gaps.map((g) => `${g.name} (${g.why})`))
        : '(none known yet)',
    ),
    tag('known', input.known.length ? bullets(input.known) : '(nothing mastered yet)'),
    tag('open_questions', input.openQuestions.length ? bullets(input.openQuestions) : '(none)'),
    tag('page', lines.join('\n'), { title: input.page.title, app: input.page.app }),
  ].join('\n')
}

/** In page order, inside the page, no overlaps (a later range starts after the earlier one). */
export function cleanRanges(out: OutlineOutput, input: OutlineInput): OutlineOutput['ranges'] {
  const ids = input.lines.map((l) => l.i)
  if (ids.length === 0) return []
  const first = Math.min(...ids)
  const last = Math.max(...ids)
  const sorted = out.ranges
    .map((r) => ({
      ...r,
      from: Math.max(first, Math.min(r.from, r.to)),
      to: Math.min(last, Math.max(r.from, r.to)),
      why: r.why.trim().split(/\s+/).slice(0, 8).join(' '),
    }))
    .filter((r) => r.from <= r.to)
    .sort((a, b) => a.from - b.from)
  const clean: OutlineOutput['ranges'] = []
  for (const r of sorted) {
    const prev = clean.at(-1)
    if (prev && r.from <= prev.to) {
      if (r.to <= prev.to) continue
      clean.push({ ...r, from: prev.to + 1 })
    } else clean.push(r)
  }
  return clean
}

export const outlinePrompt: PromptSpec<OutlineInput, OutlineOutput, OutlineOutput> = {
  id: 'P15',
  task: 'outline',
  version: 2,
  tier: 'extract',
  temperature: 0.2,
  maxOutputTokens: 1500,
  reasoningEffort: 'low',
  schemaName: 'page_outline',
  schema: OutlineOutput,
  onDeviceOk: false,
  cacheable: true,
  language: outlineLanguage,
  build: (input) => ({ system: system(outlineLanguage(input)), user: user(input) }),
  check: (out) =>
    out.ranges.some((r) => r.verdict === 'read') ? [] : ['mark at least one passage to read'],
  finalize: (out, input) => ({ summary: out.summary.trim(), ranges: cleanRanges(out, input) }),
}
