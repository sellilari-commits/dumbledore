/**
 * Line-level text helpers for episodes: cleaning, the normalised key used to recognise the same
 * line across frames, UI-noise detection and word counts.
 */

/** Trims, collapses whitespace and fixes the known OCR slip Ă→Å (docs/PLAN.md §3.4). */
export function cleanLine(text: string, fromOcr = false): string {
  const t = text.replace(/[ \t ]+/g, ' ').trim()
  return fromOcr ? t.replace(/Ă/g, 'Å').replace(/ă/g, 'å') : t
}

/** Key that survives small OCR / rendering differences between frames. */
export function lineKey(text: string): string {
  return text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[‐‑‒–—−]/g, '-')
    .replace(/[‘’‚‛]/g, "'")
    .replace(/[“”„‟]/g, '"')
    .replace(/…/g, '...')
    .replace(/\s+/g, ' ')
    .trim()
}

const UI_NOISE = new Set(
  [
    'accept',
    'accept all',
    'accept all cookies',
    'accept cookies',
    'reject all',
    'cookie settings',
    'manage cookies',
    'skip to content',
    'skip to main content',
    'sign in',
    'log in',
    'sign up',
    'log out',
    'subscribe',
    'share',
    'menu',
    'search',
    'close',
    'more',
    'back',
    'next',
    'previous',
    'home',
    'edit',
    '[edit]',
    'reply',
    'copy',
    'copy code',
    'like',
    'dislike',
    'regenerate',
    'new chat',
    'new tab',
    'hyväksy',
    'hyväksy kaikki',
    'kirjaudu',
    'kirjaudu sisään',
    'jaa',
    'sulje',
    'haku',
    'valikko',
  ].map((s) => s.toLowerCase()),
)

/** Buttons, cookie banners and stray glyphs that never carry content. */
export function isUiNoise(text: string): boolean {
  const key = lineKey(text)
  if (key.length <= 1) return true
  if (UI_NOISE.has(key)) return true
  if (/^[\p{P}\p{S}\s]+$/u.test(key)) return true // only punctuation/symbols
  return false
}

export function wordCount(text: string): number {
  const m = text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu)
  return m ? m.length : 0
}
