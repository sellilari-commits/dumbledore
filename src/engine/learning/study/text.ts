/**
 * Small text helpers shared by the study lane: name normalisation, de-duplication, trimming,
 * and the profile/language fields every brain call needs.
 */
import type { Profile } from '@shared/domain'

export const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Keeps the first spelling of each name (case/whitespace-insensitive), drops blanks. */
export function uniqueNames(names: readonly string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const name of names) {
    const key = norm(name)
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(name.trim())
  }
  return out
}

export function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const k = key(item)
    if (seen.has(k)) return false
    seen.add(k)
    return true
  })
}

/** The newest `max` characters (chat excerpts are oldest first). */
export function tail(text: string, max: number): string {
  const t = text.trim()
  return t.length <= max ? t : t.slice(t.length - max).trimStart()
}

/** The first `max` characters, cut on a word boundary when possible. */
export function head(text: string, max: number): string {
  const t = text.trim()
  if (t.length <= max) return t
  const cut = t.slice(0, max)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).trimEnd()}…`
}

/** Compact learner description for prompts (level · about me · profiler summary). */
export function profileText(profile: Profile): string {
  return [
    profile.level ? `Level: ${profile.level}` : '',
    profile.aboutMe.trim(),
    profile.summary.trim(),
  ]
    .filter(Boolean)
    .join('\n')
    .slice(0, 1200)
}

export const languageOf = (profile: Profile): string => profile.promptLanguage

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`
}

/** Score as a whole percentage; accepts 0–1 fractions and 0–100 percentages. */
export function percent(score: number): number {
  return Math.round(score <= 1 ? score * 100 : score)
}
