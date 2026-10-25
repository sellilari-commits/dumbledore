/**
 * Action chips under an Ask bar reply: each runs a CoachAction through `coach.runAction`. What the
 * chat already saved (a question, a course fact, a note) shows as a receipt line in the reply, with
 * an Undo chip here; a pressed Undo turns into "Undone".
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
  Undo2,
} from 'lucide-react'
import { useState } from 'react'

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
      return { label: n === 1 ? 'Review 1 concept' : `Review ${n} concepts`, Icon: RotateCcw }
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
  }
}

interface Props {
  actions: CoachAction[]
  onRun: (action: CoachAction) => Promise<boolean>
}

/** Saves are applied when the reply arrives (its receipt says so): only their Undo is a chip. */
const APPLIED: ReadonlySet<CoachAction['type']> = new Set([
  'add_note',
  'save_question',
  'update_subject',
])
const isUndo = (action: CoachAction) => action.type === 'undo_note' || action.type === 'undo_save'

export function ActionChips({ actions: all, onRun }: Props) {
  const [busy, setBusy] = useState<number | null>(null)
  const [undone, setUndone] = useState<ReadonlySet<number>>(new Set())
  const actions = all.filter((a) => !APPLIED.has(a.type))
  if (actions.length === 0) return null
  return (
    <div className="ask__actions">
      {actions.map((action, i) => {
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
  )
}
