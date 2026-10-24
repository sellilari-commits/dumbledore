/** Action chips under an Ask bar reply: each runs a CoachAction through `coach.runAction`. */
import type { CoachAction } from '@shared/domain'
import {
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
  }
}

interface Props {
  actions: CoachAction[]
  onRun: (action: CoachAction) => Promise<void>
}

/** The chat takes no notes: note chips kept in older replies (Save note, Undo) are not shown. */
const inChat = (action: CoachAction) => action.type !== 'add_note' && action.type !== 'undo_note'

export function ActionChips({ actions: all, onRun }: Props) {
  const [busy, setBusy] = useState<number | null>(null)
  const actions = all.filter(inChat)
  if (actions.length === 0) return null
  return (
    <div className="ask__actions">
      {actions.map((action, i) => {
        const { label, Icon } = describeAction(action)
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
              onRun(action).finally(() => setBusy(null))
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
