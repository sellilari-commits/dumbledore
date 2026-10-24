/**
 * Note matching (docs/NOTES.md §3): two notes say the same thing when their `noteKey` is equal
 * (case, spacing, punctuation and accents of the form ignored) or when their word sets overlap
 * by a token Jaccard of at least 0.8. Fuzzier duplicates are left for consolidation.
 */

/** Longest note text kept; longer text (a long highlight) is cut with an ellipsis. */
export const NOTE_MAX_CHARS = 200
export const NOTE_SIMILARITY = 0.8

export function noteKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}+\-=<>%/]+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function noteTokens(text: string): Set<string> {
  return new Set(
    noteKey(text)
      .split(' ')
      .filter((t) => t.length > 1),
  )
}

export function tokenJaccard(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size === 0 || b.size === 0) return 0
  let shared = 0
  for (const t of a) if (b.has(t)) shared++
  return shared / (a.size + b.size - shared)
}

/** Same key, or word overlap of at least NOTE_SIMILARITY. */
export function sameNote(a: string, b: string): boolean {
  const ka = noteKey(a)
  if (ka && ka === noteKey(b)) return true
  return tokenJaccard(noteTokens(a), noteTokens(b)) >= NOTE_SIMILARITY
}

/** Up to 5 distinct keywords (case-insensitive), trimmed, each at most 40 characters. */
export function cleanKeywords(...lists: readonly (readonly string[] | undefined)[]): string[] {
  const out: string[] = []
  const seen = new Set<string>()
  for (const k of lists.flatMap((l) => l ?? [])) {
    const t = k.replace(/\s+/g, ' ').trim().slice(0, 40)
    if (!t || seen.has(t.toLowerCase())) continue
    seen.add(t.toLowerCase())
    out.push(t)
    if (out.length === 5) break
  }
  return out
}

/** Trimmed, whitespace collapsed, cut at NOTE_MAX_CHARS. */
export function clipNote(text: string): string {
  const t = text.replace(/\s+/g, ' ').trim()
  return t.length > NOTE_MAX_CHARS ? `${t.slice(0, NOTE_MAX_CHARS - 1).trimEnd()}…` : t
}
