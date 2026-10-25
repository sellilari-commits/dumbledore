/**
 * What the chat changed, under its reply: one quiet row per labelled `undo_save` (a chat tool's
 * write), its receipt line and an Undo on the right. Undo runs in place; the row then reads
 * "Undone" with the line struck through. A failed Undo ("That can no longer be undone.") shows
 * as a small line in the row, and the Undo stays for another try. Unlabelled undo_saves (the
 * chat's own saves, whose receipt is in the reply text) stay plain Undo chips (ActionChips).
 */
import type { CoachAction } from '@shared/domain'
import { Check, Undo2 } from 'lucide-react'
import { useState } from 'react'

type UndoSave = Extract<CoachAction, { type: 'undo_save' }>
export type LabelledUndo = UndoSave & { label: string }

export const isReceipt = (action: CoachAction): action is LabelledUndo =>
  action.type === 'undo_save' && !!action.label?.trim()

type RowState = { kind: 'idle' | 'busy' | 'undone' } | { kind: 'failed'; message: string }

interface Props {
  actions: CoachAction[]
  onRun: (action: CoachAction) => Promise<string | null>
}

export function Receipts({ actions, onRun }: Props) {
  const receipts = actions.filter(isReceipt)
  if (receipts.length === 0) return null
  return (
    <ul className="ask__receipts" aria-label="What Dumbledore changed">
      {receipts.map((receipt, i) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: receipts are a fixed list per reply
        <ReceiptRow key={i} receipt={receipt} onRun={onRun} />
      ))}
    </ul>
  )
}

function ReceiptRow({ receipt, onRun }: { receipt: LabelledUndo; onRun: Props['onRun'] }) {
  const [state, setState] = useState<RowState>({ kind: 'idle' })
  const undo = () => {
    if (state.kind === 'busy' || state.kind === 'undone') return
    setState({ kind: 'busy' })
    onRun(receipt).then(
      (failed) => setState(failed ? { kind: 'failed', message: failed } : { kind: 'undone' }),
      () => setState({ kind: 'failed', message: 'Something went wrong' }),
    )
  }
  return (
    <li className="ask__receipt" data-state={state.kind}>
      <Check className="ask__receipt-icon" size={14} strokeWidth={1.75} aria-hidden />
      <span className="ask__receipt-body">
        <span className="ask__receipt-line">{receipt.label}</span>
        {state.kind === 'failed' && (
          <span className="ask__receipt-note" role="status">
            {state.message}
          </span>
        )}
      </span>
      {state.kind === 'undone' ? (
        <span className="ask__receipt-done">Undone</span>
      ) : (
        <button
          type="button"
          className="ask__receipt-undo"
          aria-label={`Undo: ${receipt.label}`}
          aria-disabled={state.kind === 'busy' || undefined}
          onClick={undo}
        >
          {state.kind === 'busy' ? (
            <span className="ov-spinner ask__chip-spin" aria-hidden />
          ) : (
            <Undo2 className="ask__receipt-undo-icon" size={13} strokeWidth={1.75} aria-hidden />
          )}
          <span>Undo</span>
        </button>
      )}
    </li>
  )
}
