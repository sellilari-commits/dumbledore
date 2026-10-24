/**
 * Secret and personal-data masking for screen text (docs/PLAN.md §6.5 "Privacy", §6.9).
 *
 * Applied at capture (before episode text is stored) and again before any LLM call. Masks
 * e-mails, phone numbers, IBANs, card numbers (Luhn-checked), national ids, long digit runs and
 * API keys / tokens / passwords. Long unspaced natural text (AI-chat transcripts read through
 * Accessibility often arrive glued together) is never treated as a token. Idempotent: the
 * placeholders never match a rule themselves.
 * Exported for lane L2b's Brain.
 */
import { ibanLooksValid, luhnValid } from './checksums'
import { looksLikeSecretToken } from './token-shape'

export type RedactionKind = 'email' | 'phone' | 'iban' | 'card' | 'id' | 'number' | 'secret'

export const REDACTION_PLACEHOLDER: Readonly<Record<RedactionKind, string>> = {
  email: '[email]',
  phone: '[phone]',
  iban: '[iban]',
  card: '[card]',
  id: '[id]',
  number: '[number]',
  secret: '[secret]',
}

export type RedactionCounts = Record<RedactionKind, number>

type Replacer = (match: string, ...groups: string[]) => string | null

interface Rule {
  kind: RedactionKind
  re: RegExp
  /** Returns the replacement, or null to leave the match untouched. */
  replace?: Replacer
}

const SECRET = REDACTION_PLACEHOLDER.secret

const KEY_NAMES =
  'api[_-]?key|apikey|api[_-]?secret|secret[_-]?key|client[_-]?secret|secret|access[_-]?token|auth[_-]?token|refresh[_-]?token|id[_-]?token|token|password|passwd|pwd|passcode|passphrase|salasana|l[öo]senord|passord'

const IBAN_COUNTRIES =
  'FI|SE|NO|DK|IS|EE|LV|LT|DE|GB|IE|FR|ES|PT|IT|NL|BE|LU|AT|CH|LI|PL|CZ|SK|HU|RO|BG|HR|SI|GR|CY|MT|MC|SM|AD|GI'

const digitsOf = (s: string): string => s.replace(/\D/g, '')

const RULES: readonly Rule[] = [
  // ── secrets ──────────────────────────────────────────────────────────────────────────────
  {
    kind: 'secret',
    re: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    kind: 'secret',
    re: /\b([a-z][a-z0-9+.-]*:\/\/)[^\s:@/]+:[^\s@/]+@/gi,
    replace: (_m, scheme) => `${scheme}${SECRET}@`,
  },
  { kind: 'secret', re: /\bBearer\s+[A-Za-z0-9._~+/=-]{8,}/g, replace: () => `Bearer ${SECRET}` },
  {
    kind: 'secret',
    re: /\b(Authorization\s*:\s*(?:Basic|Token|Digest))\s+[A-Za-z0-9._~+/=-]{6,}/gi,
    replace: (_m, head) => `${head} ${SECRET}`,
  },
  {
    kind: 'secret',
    // Also prefixed names, as in .env files: OPENAI_API_KEY=…, NEO4J_PASSWORD=…, and a bare KEY
    // only after a prefix (AWS_SECRET_ACCESS_KEY=…), so prose like "key = 5" stays readable.
    re: new RegExp(
      `\\b((?:[A-Za-z0-9]+[_.-])*(?:${KEY_NAMES})|(?:[A-Za-z0-9]+[_.-])+key)\\b(\\s*[:=]\\s*)(["']?)(?!\\[secret\\])([^\\s"',;]{4,})\\3`,
      'gi',
    ),
    replace: (_m, key, sep, quote) => `${key}${sep}${quote}${SECRET}${quote}`,
  },
  { kind: 'secret', re: /\bsk-(?:ant-|proj-|live-|test-)?[A-Za-z0-9_-]{16,}/g },
  { kind: 'secret', re: /\b(?:sk|pk|rk)_(?:live|test)_[A-Za-z0-9]{10,}/g },
  { kind: 'secret', re: /\bgh[pousr]_[A-Za-z0-9]{20,}/g },
  { kind: 'secret', re: /\bgithub_pat_[A-Za-z0-9_]{20,}/g },
  { kind: 'secret', re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: 'secret', re: /\bxox[abposr]-[A-Za-z0-9-]{10,}/g },
  { kind: 'secret', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: 'secret', re: /\bAIza[0-9A-Za-z_-]{35,}/g },
  { kind: 'secret', re: /\bgsk_[A-Za-z0-9]{20,}/g },
  { kind: 'secret', re: /\bnpm_[A-Za-z0-9]{36}\b/g },
  { kind: 'secret', re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g },

  // ── personal data ────────────────────────────────────────────────────────────────────────
  { kind: 'email', re: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}\b/g },
  {
    kind: 'iban',
    re: new RegExp(
      `\\b(?:${IBAN_COUNTRIES})\\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\\b`,
      'g',
    ),
    replace: (m) => (ibanLooksValid(m) ? REDACTION_PLACEHOLDER.iban : null),
  },
  {
    kind: 'card',
    re: /(?<![\d.,])\d(?:[ -]?\d){12,18}(?![\d])/g,
    replace: (m) => {
      const d = digitsOf(m)
      return d.length >= 13 && d.length <= 19 && luhnValid(d) ? REDACTION_PLACEHOLDER.card : null
    },
  },
  // Finnish henkilötunnus (incl. the 2023 century signs)
  { kind: 'id', re: /\b\d{6}[-+ABCDEFUVWXY]\d{3}[0-9A-FHJ-NPR-Y]\b/g },
  // Swedish personnummer / Danish CPR
  { kind: 'id', re: /\b(?:19|20)?\d{6}[-+]\d{4}\b/g },
  // US SSN
  { kind: 'id', re: /\b\d{3}-\d{2}-\d{4}\b/g },
  // Phone numbers: international, national with trunk 0, North American
  {
    kind: 'phone',
    re: /(?<![\w+])\+\d[\d ().-]{6,18}\d(?!\w)/g,
    replace: (m) => {
      const n = digitsOf(m).length
      return n >= 8 && n <= 15 ? REDACTION_PLACEHOLDER.phone : null
    },
  },
  {
    kind: 'phone',
    re: /(?<![\w.,/:-])\(?0\d{1,3}\)?[ .-]?\d{2,4}(?:[ .-]?\d{2,4}){1,3}(?![\w]|[.,/:-]\d)/g,
    replace: (m) => {
      const n = digitsOf(m).length
      if (n < 7 || n > 12) return null
      if (/^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}$/.test(m)) return null // a date
      if (!/[ .()-]/.test(m) && n < 9) return null
      return REDACTION_PLACEHOLDER.phone
    },
  },
  {
    kind: 'phone',
    re: /(?<![\w.,-])\(?[2-9]\d{2}\)?[ .-]\d{3}[ .-]\d{4}(?![\w]|[.,-]\d)/g,
  },
  // Long digit runs (account numbers, unseparated phone numbers); decimals are left alone.
  {
    kind: 'number',
    re: /(?<![\d]|\d[.,])\d{10,}(?![\d]|[.,]\d)/g,
  },
  // Long random-looking tokens (≥ 32 chars, base64 padding allowed). Natural text with its
  // spaces lost, formulas and readable URL segments are left alone: see token-shape.ts.
  {
    kind: 'secret',
    re: /(?<![A-Za-z0-9_+=-])[A-Za-z0-9_+-]{32,}={0,2}(?![A-Za-z0-9_+=-])/g,
    replace: (m) => (looksLikeSecretToken(m) ? SECRET : null),
  },
]

function emptyCounts(): RedactionCounts {
  return { email: 0, phone: 0, iban: 0, card: 0, id: 0, number: 0, secret: 0 }
}

/** Masks secrets and personal data; returns the text and how many of each kind were masked. */
export function redactDetailed(
  text: string,
  kinds?: ReadonlySet<RedactionKind>,
): { text: string; counts: RedactionCounts } {
  const counts = emptyCounts()
  let out = text
  for (const rule of RULES) {
    if (kinds && !kinds.has(rule.kind)) continue
    rule.re.lastIndex = 0
    out = out.replace(rule.re, (match: string, ...rest: unknown[]) => {
      // rest = [...captureGroups, offset, input, namedGroups?]; groups end at the numeric offset
      const end = rest.findIndex((x) => typeof x === 'number')
      const groups = rest.slice(0, end).map((g) => (typeof g === 'string' ? g : ''))
      const replacement = rule.replace
        ? rule.replace(match, ...groups)
        : REDACTION_PLACEHOLDER[rule.kind]
      if (replacement === null) return match
      counts[rule.kind]++
      return replacement
    })
  }
  return { text: out, counts }
}

/** Masks e-mails, phones, IBANs, cards, ids, long digit runs and keys/tokens/passwords. */
export function redact(text: string): string {
  if (!text) return text
  return redactDetailed(text).text
}

const SECRET_ONLY: ReadonlySet<RedactionKind> = new Set(['secret'])

/** Masks only keys, tokens, passwords and credentials (for scrubbing text already stored). */
export function redactSecrets(text: string): string {
  if (!text) return text
  return redactDetailed(text, SECRET_ONLY).text
}
