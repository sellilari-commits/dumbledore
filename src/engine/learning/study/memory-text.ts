/**
 * Plain-language text for the encounters the study session writes (memory-updates.ts), in the
 * same voice as perception's extraction: Seen = what the student looked at or asked, Big picture
 * = the topic path, evidence = one short plain sentence. Context labels the brain sometimes
 * echoes back ("Struggling with:", "Missed 2 times recently", "struggled 1× recently", "mastery
 * 0.90 · last seen …") are stripped, and repeated phrases are dropped.
 */
import type { UnderstandingStatus } from '@shared/domain'
import { head, norm } from './text'

/** Labels and stats lines from the shell's coach context, the memory file and Home. */
const NOISE: RegExp[] = [
  /\b(struggling with|due for review|active session|right now|subjects|level|open questions?|key terms?|evidence|understanding|seen|big picture)\s*:/gi,
  /\bstruggling with\b/gi,
  /\b(missed|struggled)\s+(\d+|once|twice)\s*(×|x|times?)?\s*(recently|lately)?\b/gi,
  /\bmissed\s+\d+\s+of\s+\d+\s+in\s+(checkpoint\s*\d*|your last (exam|review)|the placement check)\b/gi,
  /\bmastery\s+\d+(\.\d+)?%?/gi,
  /\blast seen\s+\d{4}-\d{2}-\d{2}\b/gi,
  /\bneeds another look\b/gi,
]

const tidy = (s: string): string =>
  s
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .replace(/^[\s·•\-–—,;:.]+|[\s·•\-–—,;:]+$/g, '')
    .trim()

/** Removes echoed context labels and stats from a free-text line. */
export function stripContextLabels(text: string): string {
  let t = text
  for (const re of NOISE) t = t.replace(re, ' ')
  return tidy(t.replace(/\s*·\s*(·\s*)+/g, ' · '))
}

/** Splits into phrases (sentences / "·" parts) and keeps the first spelling of each. */
export function phrasesOf(text: string, drop: (phrase: string) => boolean = () => false): string[] {
  const parts = text
    .split(/(?<=[.!?])\s+|\s*·\s*|\n+/)
    .map(tidy)
    .filter((p) => p && !drop(p))
  const seen = new Set<string>()
  const out: string[] = []
  for (const part of parts) {
    const key = norm(part).replace(/[.!?…]+$/, '')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(part)
  }
  return out
}

export const dedupePhrases = (text: string): string => phrasesOf(text).map(sentence).join(' ')

/** Cleans free text from the brain: labels out, bare concept names out, repeats out. */
function cleanText(raw: readonly string[], concept: string): string {
  const stripped = raw.map(stripContextLabels).filter(Boolean).join(' · ')
  return phrasesOf(stripped, (p) => onlyConcept(p, concept))
    .map(sentence)
    .join(' ')
}

const sentence = (s: string): string => {
  const t = tidy(s)
  if (!t) return ''
  const first = t.charAt(0).toUpperCase() + t.slice(1)
  return /[.!?…]$/.test(first) ? first : `${first}.`
}

/** True when nothing but the concept name (or nothing at all) is left. */
function onlyConcept(text: string, concept: string): boolean {
  const rest = norm(text)
    .replace(norm(concept), ' ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
  return rest.split(' ').filter((w) => w.length > 2).length < 2
}

const PLAIN_EVIDENCE: Record<UnderstandingStatus, (concept: string) => string> = {
  understood: (c) => `Explained ${c} correctly in the chat.`,
  unclear: (c) => `Not quite clear on ${c} yet.`,
  struggling: (c) => `Had trouble with ${c} in the chat.`,
  unknown: () => '',
}

/** One short plain evidence sentence for an understanding level. */
export function evidenceText(
  raw: readonly string[],
  concept: string,
  level: UnderstandingStatus | null,
): string {
  const cleaned = cleanText(raw, concept)
  if (cleaned) return head(cleaned, 240)
  return PLAIN_EVIDENCE[level ?? 'unknown'](lowerName(concept))
}

/** "Leaving groups" → "leaving groups"; acronyms and Title Case ("SN2 mechanism") stay. */
function lowerName(name: string): string {
  const t = name.trim()
  return /^[A-Z][a-z]/.test(t) && !/[A-Z]/.test(t.slice(1))
    ? t.charAt(0).toLowerCase() + t.slice(1)
    : t
}

/** What the student looked at or asked: their notes, else the step they asked the AI for. */
export function seenText(
  notes: readonly string[],
  concept: string,
  stepTitle: string,
  assistant: string,
): string {
  const cleaned = cleanText(notes, concept)
  if (cleaned) return head(cleaned, 400)
  const step = tidy(stepTitle)
  const about = !step || norm(step).includes(norm(concept)) ? step || concept : concept
  const extra = about === concept && step && norm(step) !== norm(concept) ? ` (${step})` : ''
  return `Asked ${assistant} to explain ${lowerName(about)}${extra}.`
}

/** The topic path as perception writes it: "Subject › Roadmap › Concept", repeats dropped. */
export function topicPathOf(parts: readonly string[]): string[] {
  const out: string[] = []
  for (const part of parts.map(tidy)) {
    if (!part) continue
    const last = out.at(-1)
    if (last && norm(last) === norm(part)) continue
    if (out.some((p) => norm(p) === norm(part))) continue
    out.push(part)
  }
  return out
}

export const bigPictureText = (path: readonly string[]): string => head(path.join(' › '), 240)
