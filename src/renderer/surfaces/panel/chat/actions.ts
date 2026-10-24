/** Labels and icons for coach actions: chips under chat replies and the Right-now button. */
import type { CoachAction } from '@shared/domain'
import {
  ClipboardPaste,
  FileCheck2,
  LibraryBig,
  type LucideIcon,
  Map as MapIcon,
  RotateCcw,
  Target,
} from 'lucide-react'

const short = (text: string, max = 34) =>
  text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`

export function chipFor(action: CoachAction): { label: string; Icon: LucideIcon } {
  switch (action.type) {
    case 'start_roadmap':
      return {
        label: action.goal ? `Roadmap: ${short(action.goal)}` : 'Start a roadmap',
        Icon: MapIcon,
      }
    case 'create_exam':
      return { label: `${action.spec.count}-question exam`, Icon: FileCheck2 }
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
  }
}

/** The one button under a Right-now suggestion. */
export function suggestionLabel(action: CoachAction): string {
  switch (action.type) {
    case 'start_roadmap':
      return 'Make a roadmap'
    case 'create_exam':
      return 'Quiz me'
    case 'start_review':
      return 'Start review'
    case 'insert_prompt':
      return 'Insert prompt'
    case 'set_focus':
      return 'Focus on it'
    case 'open_subject':
      return 'Open subject'
  }
}
