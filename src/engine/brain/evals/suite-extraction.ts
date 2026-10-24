/**
 * Extraction eval (PLAN §9.2): 30 labelled episodes plus 12 real ones (R*, `--only R`) through brain.extract in queue-sized batches of
 * 3 → precision/recall of "is learning", three parts always filled, "struggling" only with
 * evidence, plus understanding/subject/assignment/student-prompt agreement for diagnosis.
 */
import type { ExtractInput, ExtractOutput } from '@engine/brain-contract'
import { looksFinnish } from '../llm/text'
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
  isLearning: boolean
  subject?: string | null
  understanding?: string[]
  struggleEvidence?: boolean
  assignment?: boolean
  studentPrompts?: number
  language?: string
}
interface Fixture {
  student: ExtractInput['student']
  subjects: ExtractInput['subjects']
  cases: { id: string; label: Label; episode: Omit<ExtractInput['episodes'][number], 'id'> }[]
}
type Case = Fixture['cases'][number]
type Result = ExtractOutput['results'][number]

/** Alternate learning / not-learning cases so each batch of 3 is mixed, like real queues. */
function interleave(cases: Case[]): Case[] {
  const yes = cases.filter((c) => c.label.isLearning)
  const no = cases.filter((c) => !c.label.isLearning)
  const out: Case[] = []
  while (yes.length || no.length) {
    for (const c of [yes.shift(), yes.shift(), no.shift()]) if (c) out.push(c)
  }
  return out
}

export async function runExtraction(ctx: EvalContext): Promise<SuiteResult> {
  const fx = loadFixture<Fixture>(ctx.root, 'extraction.json')
  const picked = ctx.only ? fx.cases.filter((c) => c.id.startsWith(ctx.only as string)) : fx.cases
  const cases = interleave(take(picked, ctx.limit))
  const groups: Case[][] = []
  for (let i = 0; i < cases.length; i += 3) groups.push(cases.slice(i, i + 3))
  const outs = await pool(groups, ctx.concurrency, async (g, i) => {
    ctx.log(`extraction batch ${i + 1}/${groups.length}: ${g.map((c) => c.id).join(', ')}`)
    return ctx.brain.extract(
      {
        student: fx.student,
        subjects: fx.subjects,
        episodes: g.map((c) => ({ id: c.id, ...c.episode })),
      },
      { timeoutMs: ctx.timeoutMs },
    )
  })

  const byId = new Map<string, Result | Error>()
  groups.forEach((g, i) => {
    const out = outs[i]
    for (const c of g) {
      if (out instanceof Error || !out)
        byId.set(c.id, out instanceof Error ? out : new Error('no output'))
      else
        byId.set(c.id, out.results.find((r) => r.episodeId === c.id) ?? new Error('missing result'))
    }
  })

  let tp = 0
  let fp = 0
  let fn = 0
  let tn = 0
  let errors = 0
  let predictedLearning = 0
  let threePartsOk = 0
  let strugglingGuesses = 0
  let understandingN = 0
  let understandingOk = 0
  let subjectN = 0
  let subjectOk = 0
  let assignmentN = 0
  let assignmentOk = 0
  let promptsN = 0
  let promptsOk = 0
  let languageN = 0
  let languageOk = 0
  const rows: CaseRow[] = []

  for (const c of cases) {
    const r = byId.get(c.id)
    if (!r || r instanceof Error) {
      errors++
      rows.push({ id: c.id, ok: false, summary: `error: ${r?.message ?? 'missing'}`.slice(0, 200) })
      continue
    }
    const l = c.label
    if (r.isLearning && l.isLearning) tp++
    else if (r.isLearning && !l.isLearning) fp++
    else if (!r.isLearning && l.isLearning) fn++
    else tn++
    const notes: string[] = [
      `learning ${r.isLearning ? 'yes' : 'no'} (${r.confidence})${r.isLearning === l.isLearning ? '' : ' ✗'}`,
    ]
    let ok = r.isLearning === l.isLearning
    if (r.isLearning) {
      predictedLearning++
      const full =
        r.items.length > 0 &&
        r.items.every(
          (it) =>
            it.seen.trim() &&
            it.bigPicture.trim() &&
            it.topicPath.length > 0 &&
            it.understanding.status,
        )
      if (full) threePartsOk++
      else {
        ok = false
        notes.push('three parts missing ✗')
      }
      const guesses = r.items.filter(
        (it) => it.understanding.status === 'struggling' && !l.struggleEvidence,
      ).length
      strugglingGuesses += guesses
      if (guesses) {
        ok = false
        notes.push('struggling without evidence ✗')
      }
    }
    const first = r.items[0]
    if (l.isLearning && r.isLearning && first) {
      if (l.understanding) {
        understandingN++
        const hit = l.understanding.includes(first.understanding.status)
        if (hit) understandingOk++
        notes.push(
          `understanding ${first.understanding.status}${hit ? '' : ` (expected ${l.understanding.join('|')})`}`,
        )
      }
      if (l.subject !== undefined) {
        subjectN++
        const hit = l.subject
          ? r.items.some((it) => it.subject.matchId === l.subject)
          : r.items.every((it) => !it.subject.matchId)
        if (hit) subjectOk++
        notes.push(
          `subject ${first.subject.matchId ?? `new:${first.subject.newName}`}${hit ? '' : ' ✗'}`,
        )
      }
      if (l.assignment) {
        assignmentN++
        const a = r.items.find((it) => it.assignment)?.assignment
        if (a) assignmentOk++
        notes.push(a ? `assignment "${a.title}" due ${a.dueAt ?? '?'}` : 'assignment missed ✗')
      }
      if (l.studentPrompts) {
        promptsN++
        if (r.studentPrompts.length === l.studentPrompts) promptsOk++
        notes.push(`student prompts ${r.studentPrompts.length}/${l.studentPrompts}`)
      }
      if (l.language === 'fi') {
        languageN++
        const fi = looksFinnish(`${first.seen} ${first.bigPicture}`)
        if (fi) languageOk++
        notes.push(fi ? 'written in Finnish' : 'not in Finnish')
      }
    }
    rows.push({
      id: c.id,
      ok,
      summary: notes.join(' · '),
      detail: first
        ? `- path: ${first.topicPath.join(' › ')}\n- seen: ${clipText(first.seen, 300)}\n- big picture: ${clipText(first.bigPicture, 200)}\n- evidence: ${clipText(first.understanding.evidence, 200)}`
        : `- reason: ${r.reason}`,
    })
  }

  const precision = ratio(tp, tp + fp)
  const recall = ratio(tp, tp + fn)
  return {
    suite: 'extraction',
    metrics: {
      episodes: cases.length,
      errors,
      tp,
      fp,
      fn,
      tn,
      precision,
      recall,
      threePartsFilled: ratio(threePartsOk, predictedLearning),
      strugglingWithoutEvidence: strugglingGuesses,
      understandingAgreement: `${understandingOk}/${understandingN}`,
      subjectAgreement: `${subjectOk}/${subjectN}`,
      assignmentsFound: `${assignmentOk}/${assignmentN}`,
      studentPromptCounts: `${promptsOk}/${promptsN}`,
      finnishOutputs: `${languageOk}/${languageN}`,
    },
    thresholds: [
      atLeast('precision', precision, 0.85),
      atLeast('recall', recall, 0.8),
      atLeast('three parts always filled', ratio(threePartsOk, predictedLearning), 1),
      atMost('"struggling" without evidence', strugglingGuesses, 0),
      atMost('episodes that errored', errors, 0),
    ],
    cases: rows,
    notes: [],
  }
}
