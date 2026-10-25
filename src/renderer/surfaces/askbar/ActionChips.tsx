/**
 * Action chips under an Ask bar reply: each runs a CoachAction through `coach.runAction`. What the
 * chat already saved (a question, a course fact, a note) shows as a receipt line in the reply, with
 * an Undo chip here; a pressed Undo turns into "Undone". A chat tool's write (an undo_save with a
 * label) is a receipt row instead (Receipts.tsx), never a chip. A `run_tool` chip is a tool call
 * waiting for the student's go-ahead (a delete): it runs once, in place, then reads "Done"; a
 * failure shows as a quiet line under the chips and the chip can be pressed again.
 */
import type { CoachAction } from '@shared/domain'
import {
  Check,
  ClipboardPaste,
  FileCheck2,
  LibraryBig,
  type LucideIcon,
  Map as MapIcon,
  MessageSquare,
  RotateCcw,
  Route,
  StickyNote,
  Target,
  Trash2,
  Undo2,
} from 'lucide-react'
import { useState } from 'react'
import { isReceipt } from './Receipts'

const short = (text: string, max = 44) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

export function describeAction(action: CoachAction): { label: string; Icon: LucideIcon } {
  switch (action.type) {
    case 'start_roadmap':
      return {
        label: action.goal ? `Start roadmap: ${short(action.goal)}` : 'Start a roadmap',
        Icon: MapIcon,
      }
    case 'create_exam':
      return { label: `Create a ${action.spec.count}-question exam`, Icon: FileCheck2 }
    case 'start_review': {
      const n = action.conceptIds.length
      return { label: n === 1 ? 'Review 1 topic' : `Review ${n} topics`, Icon: RotateCcw }
    }
    case 'insert_prompt':
      return { label: 'Paste prompt into chat', Icon: ClipboardPaste }
    case 'set_focus':
      return { label: action.subjectId ? 'Focus on this subject' : 'Clear focus', Icon: Target }
    case 'open_subject':
      return { label: 'Open subject', Icon: LibraryBig }
    case 'adjust_roadmap':
      return { label: `Update roadmap: ${short(action.instruction)}`, Icon: Route }
    case 'add_note':
      return { label: `Save note: ${short(action.text)}`, Icon: StickyNote }
    case 'undo_note':
      return { label: 'Undo', Icon: Undo2 }
    case 'give_feedback':
      return { label: `Send feedback: ${short(action.text)}`, Icon: MessageSquare }
    case 'save_question':
      return { label: `Save the question: ${short(action.text)}`, Icon: StickyNote }
    case 'update_subject':
      return { label: 'Save to subject', Icon: LibraryBig }
    case 'undo_save':
      return { label: 'Undo', Icon: Undo2 }
    case 'run_tool':
      return { label: action.label, Icon: action.tool === 'delete' ? Trash2 : Check }
  }
}

interface Props {
  actions: CoachAction[]
  onRun: (action: CoachAction) => Promise<boolean>
  /** Runs a confirmation chip without closing the bar; resolves the failure message, else null. */
  onRunInPlace: (action: CoachAction) => Promise<string | null>
}

/** Saves are applied when the reply arrives (its receipt says so): only their Undo is a chip. */
const APPLIED: ReadonlySet<CoachAction['type']> = new Set([
  'add_note',
  'save_question',
  'update_subject',
])
const isUndo = (action: CoachAction) => action.type === 'undo_note' || action.type === 'undo_save'

type Confirm = Extract<CoachAction, { type: 'run_tool' }>

export function ActionChips({ actions: all, onRun, onRunInPlace }: Props) {
  const [busy, setBusy] = useState<number | null>(null)
  const [undone, setUndone] = useState<ReadonlySet<number>>(new Set())
  const [failed, setFailed] = useState<string | null>(null)
  const actions = all.filter((a) => !APPLIED.has(a.type) && !isReceipt(a))
  if (actions.length === 0) return null
  return (
    <div className="ask__actions-block">
      <div className="ask__actions">
        {actions.map((action, i) => {
          if (action.type === 'run_tool')
            return (
              <ConfirmChip
                // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed list per reply
                key={i}
                action={action}
                onRun={onRunInPlace}
                onFailed={setFailed}
              />
            )
          const { label, Icon } = describeAction(action)
          if (undone.has(i))
            return (
              // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed list per reply
              <span key={i} className="ask__chip" aria-disabled>
                <Check size={14} strokeWidth={1.75} aria-hidden />
                <span>Undone</span>
              </span>
            )
          return (
            <button
              // biome-ignore lint/suspicious/noArrayIndexKey: actions are a fixed list per reply
              key={i}
              type="button"
              className="ask__chip"
              aria-disabled={busy !== null || undefined}
              onClick={() => {
                if (busy !== null) return
                setBusy(i)
                onRun(action)
                  .then((ok) => {
                    if (ok && isUndo(action)) setUndone((u) => new Set(u).add(i))
                  })
                  .finally(() => setBusy(null))
              }}
            >
              {busy === i ? (
                <span className="ov-spinner ask__chip-spin" aria-hidden />
              ) : (
                <Icon size={14} strokeWidth={1.75} aria-hidden />
              )}
              <span>{label}</span>
            </button>
          )
        })}
      </div>
      {failed && (
        <p className="ask__quiet" role="status">
          {failed}
        </p>
      )}
    </div>
  )
}

/** A tool call waiting for the go-ahead: one press runs it, then it reads "Done". */
function ConfirmChip({
  action,
  onRun,
  onFailed,
}: {
  action: Confirm
  onRun: Props['onRunInPlace']
  onFailed: (message: string | null) => void
}) {
  const [state, setState] = useState<'idle' | 'busy' | 'done'>('idle')
  const { label, Icon } = describeAction(action)
  if (state === 'done')
    return (
      <span className="ask__chip ask__chip--confirm" data-state="done" aria-disabled title={label}>
        <Check size={14} strokeWidth={1.75} aria-hidden />
        <span>Done</span>
      </span>
    )
  return (
    <button
      type="button"
      className="ask__chip ask__chip--confirm"
      aria-disabled={state === 'busy' || undefined}
      onClick={() => {
        if (state !== 'idle') return
        setState('busy')
        onFailed(null)
        onRun(action).then(
          (failure) => {
            setState(failure ? 'idle' : 'done')
            onFailed(failure)
          },
          () => {
            setState('idle')
            onFailed('Something went wrong')
          },
        )
      }}
    >
      {state === 'busy' ? (
        <span className="ov-spinner ask__chip-spin" aria-hidden />
      ) : (
        <Icon size={14} strokeWidth={1.75} aria-hidden />
      )}
      <span>{label}</span>
    </button>
  )
}
