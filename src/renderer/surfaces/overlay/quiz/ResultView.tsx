/**
 * Quiz result: score, per-concept breakdown, the gaps, and "Fix my gaps", which pastes the
 * engine's repair prompt into the open chat (`prompt.sendToChat`), or with no chat open opens the
 * student's usual AI with the prompt (typed in, or on the clipboard).
 */
import type { MasteryStatus, QuizResult } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import { Check, Lightbulb } from 'lucide-react'
import { useState } from 'react'
import { errorMessage } from '../lib/bridge'
import './result.css'

interface Props {
  api: DumbledoreApi
  result: QuizResult
  onDone: () => void
  /** Lets the card's Enter key trigger the primary button. */
  primaryRef: { current: (() => void) | null }
}

const STATUS: Record<MasteryStatus, { label: string; color: string }> = {
  mastered: { label: 'Mastered', color: 'green' },
  learning: { label: 'Learning', color: 'yellow' },
  struggling: { label: 'Struggling', color: 'red' },
  new: { label: 'New', color: 'gray' },
}

type SendState =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'sent'; note: string }
  | { kind: 'failed'; reason: string }

export function headline(correct: number, total: number): string {
  if (total === 0) return 'No questions this time.'
  if (correct === total) return 'All correct — nicely done.'
  const missed = total - correct
  return missed === 1 ? 'One idea to fix.' : `${missed} ideas to fix.`
}

/** What happened to the fix prompt: pasted into the open chat, or the usual AI opened with it. */
export function sentNote(opened: { name: string; prefilled: boolean } | null): string {
  if (!opened) return 'Pasted into your chat'
  return opened.prefilled
    ? `Opened ${opened.name} with the prompt`
    : `Opened ${opened.name} · paste with ⌘V`
}

export function ResultView({ api, result, onDone, primaryRef }: Props) {
  const [send, setSend] = useState<SendState>({ kind: 'idle' })
  const pct = result.total > 0 ? Math.round((result.correct / result.total) * 100) : 0
  const fixPrompt = result.fixPrompt

  const fix = () => {
    if (!fixPrompt || send.kind === 'sending' || send.kind === 'sent') return
    setSend({ kind: 'sending' })
    api
      .invoke('prompt.sendToChat', fixPrompt)
      .then((r) =>
        setSend(
          r.ok
            ? { kind: 'sent', note: sentNote(r.opened ?? null) }
            : { kind: 'failed', reason: r.reason ?? 'Could not paste.' },
        ),
      )
      .catch((error: unknown) => setSend({ kind: 'failed', reason: errorMessage(error) }))
  }
  primaryRef.current = fixPrompt && send.kind === 'idle' ? fix : onDone

  return (
    <div className="ov-quiz__result">
      <div className="ov-score">
        <span className="ov-score__big">
          {result.correct}
          <span className="ov-score__of">/{result.total}</span>
        </span>
        <span className="ov-score__pct">{pct}%</span>
      </div>
      <p className="ov-score__line">{headline(result.correct, result.total)}</p>

      {result.byConcept.length > 0 && (
        <ul className="ov-concepts" aria-label="By topic">
          {result.byConcept.map((c) => (
            <li key={c.conceptName}>
              <span className="ov-concepts__name">{c.conceptName}</span>
              <span className="ov-concepts__n">
                {c.correct}/{c.total}
              </span>
              <span className="ov-tag" data-color={STATUS[c.status].color}>
                {STATUS[c.status].label}
              </span>
            </li>
          ))}
        </ul>
      )}

      {result.gaps.length > 0 && (
        <div className="ov-gaps">
          <span aria-hidden>
            <Lightbulb size={16} strokeWidth={1.75} />
          </span>
          <div>
            <strong className="ov-gaps__title">Your gaps</strong>
            <ul>
              {result.gaps.map((g) => (
                <li key={`${g.concept}:${g.misconception}`}>
                  {g.concept}: {g.misconception}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
      {!result.gaps.length && result.nextTopic && (
        <p className="ov-score__next">Next up: {result.nextTopic}</p>
      )}

      <div className="ov-quiz__actions">
        {send.kind === 'sent' && (
          <span className="ov-quiz__sent" role="status">
            <Check size={14} aria-hidden /> {send.note}
          </span>
        )}
        {send.kind === 'failed' && (
          <span className="ov-quiz__error" role="alert">
            {send.reason}
          </span>
        )}
        <button type="button" className="ov-btn" onClick={onDone}>
          Done
        </button>
        {fixPrompt && send.kind !== 'sent' && (
          <button
            type="button"
            className="ov-btn ov-btn--primary"
            aria-disabled={send.kind === 'sending' || undefined}
            onClick={fix}
          >
            Fix my gaps
          </button>
        )}
      </div>
    </div>
  )
}
