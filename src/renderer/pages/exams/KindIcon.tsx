/** The ink line icon for a quiz kind (exam, review, checkpoint, placement). */
import type { QuizKind } from '@shared/domain'
import { Compass, FilePen, type LucideIcon, RotateCcw, Target } from 'lucide-react'

const KIND_ICON: Record<QuizKind, LucideIcon> = {
  exam: FilePen,
  review: RotateCcw,
  checkpoint: Target,
  placement: Compass,
}

export function KindIcon({ kind, size = 16 }: { kind: QuizKind; size?: number }) {
  const Icon = KIND_ICON[kind]
  return <Icon size={size} strokeWidth={size > 24 ? 1.5 : 1.75} />
}
