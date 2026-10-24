/**
 * Blind verification of generated questions (PLAN §6.6, P5 verifier).
 *
 * The verifier answers every question without the key. A question whose blind answer differs from
 * its key (or that gets no verdict) is regenerated — up to `maxRegenerations` times, each new
 * version verified again — and dropped if it still fails. When the verifier itself is unavailable
 * the questions are kept unverified rather than losing the quiz.
 */
import type { Brain, CallOptions, QuestionDraft } from '@engine/brain-contract'
import { defaultLog, type Log, sanitizeDrafts } from './drafts'

export type Regenerate = (failed: QuestionDraft[]) => Promise<QuestionDraft[]>

export interface VerifyOutcome {
  /** Kept questions in their original order (a regenerated question takes its slot). */
  questions: QuestionDraft[]
  dropped: number
  regenerated: number
  /** False when the verifier failed and some questions were kept without a check. */
  verified: boolean
}

export interface VerifyOptions {
  brain: Brain
  drafts: QuestionDraft[]
  regenerate: Regenerate
  maxRegenerations?: number
  callOptions?: CallOptions
  log?: Log
}

interface Pending {
  slot: number
  draft: QuestionDraft
}

export async function verifyWithRetries(opts: VerifyOptions): Promise<VerifyOutcome> {
  const { brain, regenerate, callOptions } = opts
  const log = opts.log ?? defaultLog
  const maxRegenerations = opts.maxRegenerations ?? 2
  const slots: (QuestionDraft | null)[] = opts.drafts.map(() => null)
  let pending: Pending[] = opts.drafts.map((draft, slot) => ({ slot, draft }))
  let regenerated = 0
  let dropped = 0
  let verified = true

  for (let attempt = 0; pending.length > 0; attempt++) {
    let verdicts: Map<number, number>
    try {
      const results = await brain.verifyQuestions(
        pending.map((p) => p.draft),
        callOptions,
      )
      verdicts = new Map(results.map((r) => [r.index, r.chosen]))
    } catch (error) {
      log('verifier unavailable; keeping questions unverified', error)
      for (const p of pending) slots[p.slot] = p.draft
      verified = false
      break
    }

    const failed = pending.filter((p, k) => verdicts.get(k) !== p.draft.correctIndex)
    for (const p of pending) if (!failed.includes(p)) slots[p.slot] = p.draft
    if (failed.length === 0) break
    if (attempt >= maxRegenerations) {
      dropped += failed.length
      break
    }

    let fresh: QuestionDraft[] = []
    try {
      const kept = slots.filter((q): q is QuestionDraft => q !== null).map((q) => q.stem)
      const raw = await regenerate(failed.map((p) => p.draft))
      fresh = sanitizeDrafts(raw, kept).slice(0, failed.length)
    } catch (error) {
      log('regenerating mismatched questions failed', error)
    }
    dropped += failed.length - fresh.length
    regenerated += fresh.length
    pending = failed.flatMap((p, k) => {
      const draft = fresh[k]
      return draft ? [{ slot: p.slot, draft }] : []
    })
  }

  return {
    questions: slots.filter((q): q is QuestionDraft => q !== null),
    dropped,
    regenerated,
    verified,
  }
}
