/**
 * Outline eval (P15, the right-⌥ hold): real Wikipedia pages, each with a student's subject, goal,
 * gaps, mastered topics and open questions, and passages labelled by hand: must read (a good
 * outline marks them READ for this student) and must not read (history, references, see also,
 * what they already know). The page goes through the app's own `pageText` (citations out, a long
 * page cut around the screen), then brain.outline.
 *
 * Each page runs twice: the whole page (what the outline reads since 2026-10-25) and only its
 * first screen (what it read before), so the report shows what reading the whole page buys.
 *   · read hit: must-read passages marked READ
 *   · false read: must-not-read passages marked READ
 *   · read share: the share of the page's text marked READ (P15 is asked for 10–30%)
 */
import type { OutlineInput, OutlineOutput } from '@engine/brain-contract'
import { pageText } from '@engine/perception/outline-page'
import type { PerceivedWindow } from '@shared/helper-protocol'
import {
  atLeast,
  atMost,
  type CaseRow,
  clipText,
  type EvalContext,
  loadFixture,
  pool,
  ratio,
  type SuiteResult,
  take,
} from './common'

interface Label {
  text: string
  why: string
  /** The fixture line it is on. */
  line: number
}

export interface OutlineCase {
  id: string
  title: string
  url: string
  subject: string
  goal: string | null
  gaps: OutlineInput['gaps']
  known: string[]
  openQuestions: string[]
  lines: string[]
  mustRead: Label[]
  mustNotRead: Label[]
}

/** About one laptop screen of an article's text: what a hold read before whole-page reads. */
export const SCREEN_CHARS = 2500

/** How many of the page's first lines fit on one screen (at least 6, the outline's minimum). */
export function screenLines(lines: readonly string[]): number {
  let chars = 0
  let n = 0
  while (n < lines.length && (n < 6 || chars + (lines[n]?.length ?? 0) <= SCREEN_CHARS)) {
    chars += lines[n]?.length ?? 0
    n++
  }
  return n
}

/**
 * The lines the outline sends for this page, as fixture line numbers: the first screen on
 * screen (with boxes), the rest out of view (no box), through the app's pageText.
 */
export function sentLines(c: OutlineCase, mode: 'whole' | 'screen'): number[] {
  const screen = screenLines(c.lines)
  const count = mode === 'whole' ? c.lines.length : screen
  const lines = c.lines.slice(0, count).map((text, i) => ({
    text,
    conf: 1,
    box: i < screen ? { x: 100, y: 100 + i * 24, width: 700, height: 20 } : null,
    align: null,
    i,
  }))
  const win: PerceivedWindow = {
    pid: 1,
    bundleId: 'com.google.Chrome',
    appName: 'Google Chrome',
    windowId: 1,
    title: c.title,
    url: c.url,
    frame: { x: 0, y: 0, width: 1440, height: 900 },
    source: 'ax',
    changed: true,
    contentHash: c.id,
    capturedAt: '2026-10-25T00:00:00.000Z',
    lines,
  }
  return pageText(win, false).map((l) => (l as (typeof lines)[number]).i)
}

export function outlineInput(c: OutlineCase, sent: readonly number[]): OutlineInput {
  return {
    subject: { name: c.subject, goal: c.goal },
    page: { title: c.title, app: 'Google Chrome', kind: 'page' },
    gaps: c.gaps,
    known: c.known,
    openQuestions: c.openQuestions,
    lines: sent.map((n, i) => ({ i, text: c.lines[n] ?? '' })),
    language: 'en',
  }
}

export interface OutlineScore {
  hits: Label[]
  missed: Label[]
  falseReads: Label[]
  /** Share of the sent text marked READ. */
  readShare: number
  /** The READ passages: fixture lines and why. */
  reads: { from: number; to: number; why: string }[]
}

/** Scores P15's ranges (over the sent lines) against the case's labels. */
export function scoreOutline(
  c: OutlineCase,
  sent: readonly number[],
  out: OutlineOutput,
): OutlineScore {
  const read = new Set<number>()
  const reads: OutlineScore['reads'] = []
  for (const r of out.ranges) {
    if (r.verdict !== 'read') continue
    const lines = sent.slice(Math.max(0, r.from), r.to + 1)
    for (const n of lines) read.add(n)
    if (lines.length > 0) reads.push({ from: lines[0] ?? 0, to: lines.at(-1) ?? 0, why: r.why })
  }
  const chars = (ns: Iterable<number>) =>
    [...ns].reduce((sum, n) => sum + (c.lines[n]?.length ?? 0), 0)
  return {
    hits: c.mustRead.filter((l) => read.has(l.line)),
    missed: c.mustRead.filter((l) => !read.has(l.line)),
    falseReads: c.mustNotRead.filter((l) => read.has(l.line)),
    readShare: ratio(chars(read), chars(sent)),
    reads,
  }
}

function detail(c: OutlineCase, s: OutlineScore, screen: OutlineScore | null): string {
  const label = (l: Label) => `line ${l.line}: “${clipText(l.text, 90)}” (${l.why})`
  const rows = [
    ...s.reads.map(
      (r) =>
        `- READ lines ${r.from}–${r.to} · ${r.why} · “${clipText(c.lines[r.from] ?? '', 100)}”`,
    ),
    ...s.missed.map((l) => `- ✗ missed ${label(l)}`),
    ...s.falseReads.map((l) => `- ✗ marked ${label(l)}`),
  ]
  if (screen) {
    rows.push(
      `- first screen only (lines 0–${screenLines(c.lines) - 1}): ${screen.hits.length}/${c.mustRead.length} must-read marked${screen.missed.length ? `; out of reach: ${screen.missed.map((l) => `line ${l.line}`).join(', ')}` : ''}`,
    )
  }
  return rows.join('\n')
}

export async function runOutline(ctx: EvalContext): Promise<SuiteResult> {
  const fx = loadFixture<{ cases: OutlineCase[] }>(ctx.root, 'outline-pages.json')
  const picked = ctx.only ? fx.cases.filter((c) => c.id.startsWith(ctx.only as string)) : fx.cases
  const cases = take(picked, ctx.limit)
  const jobs = cases.flatMap((c) => (['whole', 'screen'] as const).map((mode) => ({ c, mode })))
  const outs = await pool(jobs, ctx.concurrency, async ({ c, mode }) => {
    ctx.log(`outline ${c.id} (${mode === 'whole' ? 'whole page' : 'first screen'})`)
    const sent = sentLines(c, mode)
    const out = await ctx.brain.outline(outlineInput(c, sent), { timeoutMs: ctx.timeoutMs })
    return { sent, score: scoreOutline(c, sent, out), summary: out.summary }
  })

  const rows: CaseRow[] = []
  const notes: string[] = []
  let mustRead = 0
  let hitWhole = 0
  let hitScreen = 0
  let mustNot = 0
  let falseReads = 0
  const shares: number[] = []
  let failed = 0
  cases.forEach((c, k) => {
    const whole = outs[k * 2]
    const screen = outs[k * 2 + 1]
    if (!whole || whole instanceof Error) {
      failed++
      rows.push({ id: c.id, ok: false, summary: `failed: ${whole?.message ?? 'no result'}` })
      return
    }
    const s = whole.score
    const sc = screen && !(screen instanceof Error) ? screen.score : null
    mustRead += c.mustRead.length
    mustNot += c.mustNotRead.length
    hitWhole += s.hits.length
    hitScreen += sc?.hits.length ?? 0
    falseReads += s.falseReads.length
    shares.push(s.readShare)
    rows.push({
      id: c.id,
      ok: s.missed.length === 0 && s.falseReads.length === 0,
      summary:
        `${c.title} · ${whole.sent.length} lines sent · must-read ${s.hits.length}/${c.mustRead.length}` +
        ` · false reads ${s.falseReads.length}/${c.mustNotRead.length}` +
        ` · ${Math.round(s.readShare * 100)}% of the text marked READ` +
        (sc ? ` · first screen only: ${sc.hits.length}/${c.mustRead.length}` : ''),
      detail: detail(c, s, sc),
    })
  })
  if (failed) notes.push(`${failed} page(s) failed (timeout or provider error): counted as misses.`)
  notes.push(
    `“First screen only” sends the page’s first ~${SCREEN_CHARS} characters, what a hold read before whole-page reads.`,
    'With --via-app the calls are the app’s (its usage log has the models); a rerun may be answered from its cache.',
  )
  const avgShare = shares.length
    ? ratio(
        shares.reduce((a, b) => a + b, 0),
        shares.length,
      )
    : 0
  const hitRate = ratio(hitWhole, mustRead)
  const screenRate = ratio(hitScreen, mustRead)
  const falseRate = ratio(falseReads, mustNot)
  return {
    suite: 'outline',
    metrics: {
      pages: cases.length,
      'must-read passages': mustRead,
      'read hit (whole page)': hitRate,
      'read hit (first screen only)': screenRate,
      'false reads': falseRate,
      'read share (avg)': avgShare,
    },
    thresholds: [
      atLeast('read hit (whole page)', hitRate, 0.75),
      atMost('false reads', falseRate, 0.1),
      atMost('read share (avg)', avgShare, 0.35),
    ],
    cases: rows,
    notes,
  }
}
