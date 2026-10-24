/**
 * Local, free prefilter (docs/PLAN.md §6.4, R27). Since batched extraction it is mainly a pre-gate
 * (`gate`): hard rules and obvious noise stay out; everything else goes to the window's triage
 * call (P0), which decides. The score threshold (`pass`) is kept as the fallback decision when
 * triage fails. Highlighted episodes always pass both.
 *
 * Hard requirements: dwell ≥ 10 s (any dwell for AI chats; a visit's first segment closes at
 * ~12 s) and ≥ 150 characters of clean text.
 * Never sent: Dumbledore's own interface read back from another window (a UI preview in a browser
 * or in the Claude app's preview pane, the mock chat test page) and an AI chat's empty start page
 * (only menus, sign-in and cookie text, no conversation). Then a 0–1 score from app/domain hints, academic vocabulary density, maths notation, deadline
 * cues and behaviour signals. Episodes at or above the threshold go to the extraction queue.
 */
import type { Episode } from '@shared/domain'
import { parseUrl } from '../../privacy/url'
import { siteHints } from './site-hints'
import { academicDensity, mathDensity } from './vocabulary'

export interface PrefilterOptions {
  minDwellSeconds: number
  minChars: number
  threshold: number
  /** Below this score an episode is obvious noise (social feed, entertainment) and skips triage. */
  noiseFloor: number
}

export const PREFILTER_DEFAULTS: PrefilterOptions = {
  minDwellSeconds: 10,
  minChars: 150,
  threshold: 0.45,
  noiseFloor: 0.2,
}

export interface PrefilterResult {
  /** Passes the pre-gate: worth asking triage about. */
  gate: boolean
  /** Old score decision: the fallback when triage is unavailable. */
  pass: boolean
  score: number
  cleanChars: number
  reasons: string[]
}

const DEADLINE_CUE =
  /(\bdue date\b|\bdue (on|by|at)\b|\bis due\b|\bdue:|\bdeadline\b|\bsubmission\b|\bsubmit by\b|\bmääräaika|\bpalautus|\bpalautettava|\binlämning|\bsista dag)/i
const ALIGN_TAG = /^\[(L|C|R)\] /gm

/**
 * Dumbledore's own screens (its app sidebar, the onboarding key demo, tools/mock-chat). Real app
 * windows are never read (own pid), but a UI preview elsewhere is, and in mock mode it is full of
 * demo subjects that must never become the student's memory.
 */
const OWN_UI = [
  /\bDumbledore Search ⌘K (?:Home )?(?:Inbox|Memory)(?: \d+)? Exams Settings\b/,
  /\bMeet the Dumbledore key\b/,
  /\bMock chat for Dumbledore tests\b/,
]

/** Sign-in, terms and cookie lines on an AI chat's start page (en, fi, sv). */
const CHAT_HOME_CHROME =
  /(\blog ?in to\b|\bsign (in|up)\b|\bcookie|terms ?(of|and|&)|privacy policy|\byou agree\b|\bby using\b|\bkirjaudu|\bevästee|\bkäyttöehd|\btietosuoj|\btekoäly|\blogga in\b|\bvillkor)/i
/** A line this long is a typed prompt even if it mentions terms or privacy. */
const MAX_CHROME_WORDS = 25
const MIN_TURN_WORDS = 8

/** Real words only (2+ letters), so OCR'd tab strips and URLs do not count as a sentence. */
function wordCount(line: string): number {
  let n = 0
  for (const w of line.split(/\s+/)) {
    if (/^\p{L}{2,}$/u.test(w.replace(/^[^\p{L}]+|[^\p{L}]+$/gu, ''))) n++
  }
  return n
}

/** True for Dumbledore's own interface read back from another window. */
export function isOwnUi(clean: string): boolean {
  return OWN_UI.some((re) => re.test(clean))
}

/**
 * An AI chat's start page (chatgpt.com/, gemini.google.com/app, claude.ai/new) with nothing typed:
 * no line long enough to be a question or an answer once sign-in, terms and cookie text is set
 * aside. A conversation page (/c/…, /app/<id>) or a typed prompt always counts.
 */
export function isEmptyChatHome(ep: Pick<Episode, 'kind' | 'url' | 'text'>): boolean {
  if (ep.kind !== 'ai_chat') return false
  const url = parseUrl(ep.url)
  if (!url?.host) return false
  if (url.path.split('/').filter(Boolean).length > 1) return false
  for (const raw of ep.text.split('\n')) {
    const line = raw.replace(ALIGN_TAG, '').trim()
    const words = wordCount(line)
    if (words < MIN_TURN_WORDS) continue
    if (words < MAX_CHROME_WORDS && CHAT_HOME_CHROME.test(line)) continue
    return false
  }
  return true
}

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
  let gate = score >= opts.noiseFloor
  if (!gate) reasons.push('noise')
  const block = (reason: string) => {
    pass = false
    gate = false
    reasons.push(reason)
  }
  if (isOwnUi(clean)) block('dumbledore ui')
  else if (isEmptyChatHome(ep)) block('empty chat page')
  if (!isChat && ep.dwellSeconds < opts.minDwellSeconds)
    block(`dwell ${ep.dwellSeconds}s < ${opts.minDwellSeconds}s`)
  if (clean.length < opts.minChars) block(`${clean.length} chars < ${opts.minChars}`)
  // Text the student highlighted is a note they chose to keep: always extracted.
  if ((ep.signals.highlights?.length ?? 0) > 0 && !isOwnUi(clean)) {
    pass = true
    gate = true
    reasons.push('highlighted')
  }
  return { gate, pass, score: Math.round(score * 100) / 100, cleanChars: clean.length, reasons }
}
