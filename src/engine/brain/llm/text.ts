/**
 * Cheap text helpers for routing decisions: token estimates (for rate-limit buckets and the
 * on-device 4K context), Finnish detection (Apple's model does not support Finnish), word
 * counts and truncation for prompt inputs.
 */

/** Conservative token estimate (≈3.5 chars/token; non-ASCII text counts heavier). */
export function estimateTokens(text: string): number {
  if (!text) return 0
  let ascii = 0
  let other = 0
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) < 128) ascii++
    else other++
  }
  return Math.ceil(ascii / 3.5 + other / 1.5)
}

export function estimateMessagesTokens(system: string, messages: { content: string }[]): number {
  return estimateTokens(system) + messages.reduce((n, m) => n + estimateTokens(m.content) + 4, 8)
}

const FI_WORDS = new Set(
  (
    'ja on ei että se joka kun mutta myös tai ovat oli olen olet ole tämä tämän siitä sen niin kuin ' +
    'mitä miten miksi voi voin olla minä mä sinä hän jos nyt vain kanssa mukaan jälkeen aikana koska ' +
    'eli esim sekä kaikki ennen yli alle mikä missä mihin miksi enkä en et emme ymmärrä selitä ' +
    'kerro auta tehtävä tehtävät kurssi luento luku sivu vastaus kysymys esimerkki ' +
    'eikä vielä jo aina usein paljon vähän hyvin myöhemmin tänään huomenna'
  ).split(' '),
)
const EN_WORDS = new Set(
  (
    'the and is are was were of to in that it for on with as by this be not or from at an which ' +
    'what how why you we they i my your can will do does'
  ).split(' '),
)
const FI_SUFFIX =
  /(ssa|ssä|sta|stä|lla|llä|lta|ltä|lle|ksi|nen|sen|ista|istä|ään|ään|eita|iden|jen|tta|ttä)$/

/** True when the text is most likely Finnish. */
export function looksFinnish(text: string): boolean {
  const words = text.toLowerCase().match(/[a-zåäö]+/g) ?? []
  if (words.length < 4) return /[äö]/i.test(text) && words.some((w) => FI_WORDS.has(w))
  let fi = 0
  let en = 0
  let suffix = 0
  for (const w of words) {
    if (FI_WORDS.has(w)) fi++
    if (EN_WORDS.has(w)) en++
    if (w.length > 4 && FI_SUFFIX.test(w)) suffix++
  }
  if (fi <= en) return false
  return (fi + suffix * 0.5) / words.length > 0.1
}

/** Resolves a language hint ("en", "fi", "auto", …) against the content. */
export function resolveLanguage(hint: string | null | undefined, ...content: string[]): string {
  const h = (hint ?? 'auto').toLowerCase()
  if (h && h !== 'auto') return h.slice(0, 2)
  return looksFinnish(content.join('\n')) ? 'fi' : 'en'
}

export function countWords(text: string): number {
  return (text.trim().match(/\S+/g) ?? []).length
}

/** Keeps the head and the tail (most recent) of long text, marking the cut. */
export function clip(text: string, maxChars: number): string {
  const t = text.trim()
  if (t.length <= maxChars) return t
  const head = Math.floor(maxChars * 0.4)
  const tail = maxChars - head - 7
  return `${t.slice(0, head)}\n[…]\n${t.slice(t.length - tail)}`
}

/** Keeps the end of the text (newest chat turns), marking the cut. */
export function clipTail(text: string, maxChars: number): string {
  const t = text.trim()
  if (t.length <= maxChars) return t
  return `[…]${t.slice(t.length - maxChars + 3)}`
}
