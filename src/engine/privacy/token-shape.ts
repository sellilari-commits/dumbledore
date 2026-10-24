/**
 * Tells a random-looking secret (API key, session token, hash) apart from natural text that
 * happens to have lost its spaces. Accessibility often hands AI-chat transcripts over as one long
 * line with the words glued together ("SN1reactionsgothroughacarbocation…"), and that study
 * content must survive redaction. Used by the generic long-token rule in `redact.ts`; tokens with
 * a known prefix (sk-, gsk_, AIza, eyJ…) are matched by their own rules and never reach this.
 *
 * Signals, all on the alphanumeric characters only:
 *  - class mix: a token needs both letters and digits (letters-only runs are text);
 *  - hex: all-hex runs (hashes, UUIDs) are secrets when not degenerate;
 *  - chemistry: a run that parses as element symbols + counts (CH3CH2OH…) is a formula;
 *  - entropy: below ~3.2 bits/char it is repetitive notation, not a random token;
 *  - case/digit switching: random base62/base36 switches class on ~40–60 % of characters,
 *    glued prose on a few percent;
 *  - letter bigrams: in natural language (English, Finnish, Swedish, German) a large share of
 *    adjacent letter pairs are common bigrams; in random letters ~10 % are.
 * Calibrated by simulation: ≥ 98 % of random base62/base36/base64 tokens of 32 chars (≥ 99.9 %
 * at 64 chars) and all hex tokens are still classified as secrets.
 */

/** Common letter pairs across English, Finnish, Swedish and German. */
const COMMON_BIGRAMS = new Set(
  (
    'th he in er an re on at en nd ti es or te of ed is it al ar st to nt ng se ha as ou io le ' +
    've co me de hi ri ro ic ne ea ra ce li ch ll be ma si om ur ca el la ns di ta ka sa ja aa ' +
    'tt ai ke ss ii un oi va uu ku ei ie ge sc ut ol il ow wi ly ec ac ot pr no ct us et lo'
  ).split(' '),
)

const ELEMENTS =
  'He|Li|Be|Ne|Na|Mg|Al|Si|Cl|Ar|Ca|Sc|Ti|Cr|Mn|Fe|Co|Ni|Cu|Zn|Ga|Ge|As|Se|Br|Kr|Rb|Sr|Zr|Mo|Pd|Ag|Cd|Sn|Sb|Te|Xe|Cs|Ba|La|Pt|Au|Hg|Pb|Bi|Rn|Ra|H|B|C|N|O|F|P|S|K|V|I|U|W'

/** Element symbols with optional counts, e.g. CH3CH2CH2OH, H2SO4HNO3. */
const FORMULA = new RegExp(`^(?:(?:${ELEMENTS})\\d*)+$`)

const MIN_ENTROPY_BITS = 3.2
const MIN_CLASS_SWITCH_RATE = 0.15
const MIN_TEXT_BIGRAM_PAIRS = 8
const MIN_TEXT_BIGRAM_SHARE = 0.38

/** Shannon entropy in bits per character. */
export function shannonEntropy(s: string): number {
  if (!s) return 0
  const freq = new Map<string, number>()
  for (const c of s) freq.set(c, (freq.get(c) ?? 0) + 1)
  let bits = 0
  for (const n of freq.values()) {
    const p = n / s.length
    bits -= p * Math.log2(p)
  }
  return bits
}

const charClass = (c: string): number => (c >= 'a' && c <= 'z' ? 0 : c >= 'A' && c <= 'Z' ? 1 : 2)

/** Share of adjacent characters that switch between lower / upper / digit. */
function classSwitchRate(s: string): number {
  if (s.length < 2) return 0
  let switches = 0
  for (let i = 1; i < s.length; i++)
    if (charClass(s.charAt(i)) !== charClass(s.charAt(i - 1))) switches++
  return switches / (s.length - 1)
}

/** Share of adjacent letter pairs (inside words; camelCase joints skipped) that are common bigrams. */
function commonBigramShare(s: string): { pairs: number; share: number } {
  let pairs = 0
  let hits = 0
  for (const run of s.match(/[A-Za-z]+/g) ?? []) {
    for (let i = 1; i < run.length; i++) {
      const a = run.charAt(i - 1)
      const b = run.charAt(i)
      if (charClass(a) === 0 && charClass(b) === 1) continue // "…Reaction|Proceeds…" joint
      pairs++
      if (COMMON_BIGRAMS.has(`${a}${b}`.toLowerCase())) hits++
    }
  }
  return { pairs, share: pairs ? hits / pairs : 0 }
}

/** True when a long run of [A-Za-z0-9_+-] characters looks like a random secret, not text. */
export function looksLikeSecretToken(token: string): boolean {
  const s = token.replace(/[^A-Za-z0-9]/g, '')
  if (!/\d/.test(s) || !/[A-Za-z]/.test(s)) return false
  if (/^[0-9a-f]+$/i.test(s)) return shannonEntropy(s) >= 3
  if (FORMULA.test(s)) return false
  if (shannonEntropy(s) < MIN_ENTROPY_BITS) return false
  if (classSwitchRate(s) < MIN_CLASS_SWITCH_RATE) return false
  const { pairs, share } = commonBigramShare(s)
  return !(pairs >= MIN_TEXT_BIGRAM_PAIRS && share >= MIN_TEXT_BIGRAM_SHARE)
}
