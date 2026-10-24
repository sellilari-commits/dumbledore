/**
 * Question drafts → stored questions: validation, de-duplication, concept resolution and the
 * small text helpers the quiz modules share.
 */
import { QuestionDraft } from '@engine/brain-contract'
import type { Repos } from '@engine/contracts'
import { newId } from '@engine/ids'
import type { Concept, Id, Question } from '@shared/domain'

export type Log = (message: string, error?: unknown) => void

export const defaultLog: Log = (message, error) => {
  console.warn(`[quiz] ${message}`, error ?? '')
}

export const normalize = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

export const words = (s: string): string[] => s.trim().split(/\s+/).filter(Boolean)

/** Trims text to `max` words, adding "…" when something was cut. */
export function clampWords(s: string, max: number): string {
  const w = words(s)
  return w.length <= max ? w.join(' ') : `${w.slice(0, max).join(' ')}…`
}

export function chunk<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size))
  return out
}

export function distinctBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** Schema-valid, trimmed drafts with four distinct options; duplicate stems dropped. */
export function sanitizeDrafts(
  drafts: readonly unknown[],
  skipStems: readonly string[] = [],
): QuestionDraft[] {
  const seen = new Set(skipStems.map(normalize))
  const out: QuestionDraft[] = []
  for (const raw of drafts) {
    const parsed = QuestionDraft.safeParse(raw)
    if (!parsed.success) continue
    const d = parsed.data
    const draft: QuestionDraft = {
      ...d,
      concept: d.concept.trim(),
      stem: d.stem.trim(),
      options: d.options.map((o) => o.trim()),
      rationales: d.rationales.map((r) => r.trim()),
    }
    if (!draft.stem || draft.options.some((o) => !o)) continue
    if (new Set(draft.options.map(normalize)).size < 4) continue
    const key = normalize(draft.stem)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(draft)
  }
  return out
}

export function toQuestion(
  draft: QuestionDraft,
  conceptId: Id | null,
  carriedFrom: Id | null = null,
): Question {
  return {
    id: newId('qst'),
    conceptName: draft.concept,
    conceptId,
    stem: draft.stem,
    options: [...draft.options],
    correctIndex: draft.correctIndex,
    rationales: [...draft.rationales],
    difficulty: draft.difficulty,
    carriedFrom,
  }
}

/** Finds a concept by name: first among `known`, then in the given subjects. */
export function conceptFinder(repos: Repos, subjectIds: readonly Id[], known: readonly Concept[]) {
  const byName = new Map(known.map((c) => [normalize(c.name), c]))
  return (name: string): Concept | null => {
    const key = normalize(name)
    if (!key) return null
    const hit = byName.get(key)
    if (hit) return hit
    for (const subjectId of subjectIds) {
      const found = repos.concepts.findByName(subjectId, name)
      if (found) {
        byName.set(key, found)
        return found
      }
    }
    return null
  }
}

/** Compact "what the student saw" digest for grounding generated questions (token-frugal). */
export function studiedDigest(repos: Repos, subjectIds: readonly Id[], maxChars = 1200): string {
  const lines: string[] = []
  for (const subjectId of subjectIds) {
    for (const e of repos.encounters.list({ subjectId, limit: 4 })) {
      if (e.inboxState === 'ignored') continue
      lines.push(`- ${e.seen.slice(0, 220)}`)
    }
  }
  return lines.join('\n').slice(0, maxChars)
}
