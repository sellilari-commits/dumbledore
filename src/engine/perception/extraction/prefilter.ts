/**
 * Local, free prefilter (docs/PLAN.md §6.4, R27): does an episode deserve an LLM extraction call?
 *
 * Hard requirements: dwell ≥ 20 s (any dwell for AI chats) and ≥ 150 characters of clean text.
 * Then a 0–1 score from app/domain hints, academic vocabulary density, maths notation, deadline
 * cues and behaviour signals. Episodes at or above the threshold go to the extraction queue.
 */
import type { Episode } from '@shared/domain'
import { siteHints } from './site-hints'
import { academicDensity, mathDensity } from './vocabulary'

export interface PrefilterOptions {
  minDwellSeconds: number
  minChars: number
  threshold: number
}

export const PREFILTER_DEFAULTS: PrefilterOptions = {
  minDwellSeconds: 20,
  minChars: 150,
  threshold: 0.45,
}

export interface PrefilterResult {
  pass: boolean
  score: number
  cleanChars: number
  reasons: string[]
}

const DEADLINE_CUE =
  /(\bdue date\b|\bdue (on|by|at)\b|\bis due\b|\bdue:|\bdeadline\b|\bsubmission\b|\bsubmit by\b|\bmääräaika|\bpalautus|\bpalautettava|\binlämning|\bsista dag)/i
const ALIGN_TAG = /^\[(L|C|R)\] /gm

/** Episode text without alignment tags, whitespace collapsed. */
export function cleanEpisodeText(text: string): string {
  return text.replace(ALIGN_TAG, '').replace(/\s+/g, ' ').trim()
}

export function prefilter(ep: Episode, options: Partial<PrefilterOptions> = {}): PrefilterResult {
  const opts = { ...PREFILTER_DEFAULTS, ...options }
  const clean = cleanEpisodeText(ep.text)
  const reasons: string[] = []
  const isChat = ep.kind === 'ai_chat'

  let score = 0.3
  if (isChat) {
    score += 0.35
    reasons.push('ai chat')
  }
  for (const hint of siteHints(ep.bundleId, ep.url, ep.title)) {
    if (isChat && hint.weight < 0) continue // e.g. Grok on x.com
    score += hint.weight
    reasons.push(`${hint.kind} ${hint.weight > 0 ? '+' : ''}${hint.weight}`)
  }
  const { density } = academicDensity(clean)
  const vocab = Math.min(0.35, density * 5)
  if (vocab > 0) {
    score += vocab
    reasons.push(`vocabulary ${(density * 100).toFixed(1)}%`)
  }
  if (mathDensity(clean) >= 0.5) {
    score += 0.1
    reasons.push('maths notation')
  }
  if (DEADLINE_CUE.test(clean)) {
    score += 0.15
    reasons.push('deadline cue')
  }
  if (ep.dwellSeconds >= 300) score += 0.1
  else if (ep.dwellSeconds >= 120) score += 0.05
  if (
    ep.signals.scrollBacks >= 2 ||
    ep.signals.searches.length > 0 ||
    ep.signals.aiQuestions.length > 0
  ) {
    score += 0.05
    reasons.push('engaged')
  }
  score = Math.max(0, Math.min(1, score))

  let pass = score >= opts.threshold
  if (!isChat && ep.dwellSeconds < opts.minDwellSeconds) {
    pass = false
    reasons.push(`dwell ${ep.dwellSeconds}s < ${opts.minDwellSeconds}s`)
  }
  if (clean.length < opts.minChars) {
    pass = false
    reasons.push(`${clean.length} chars < ${opts.minChars}`)
  }
  return { pass, score: Math.round(score * 100) / 100, cleanChars: clean.length, reasons }
}
