/**
 * Meaning → colour. The only place that decides which Notion colour a status gets
 * (PLAN §3.2): gray new · yellow learning · red struggling/wrong · green mastered/correct ·
 * orange due · blue in progress · purple exam.
 */
import type {
  MasteryStatus,
  NotionColor,
  QuizKind,
  TeachingMove,
  UnderstandingStatus,
} from '@shared/domain'

export interface StatusLabel {
  label: string
  color: NotionColor
}

export const MASTERY: Record<MasteryStatus, StatusLabel> = {
  new: { label: 'New', color: 'gray' },
  learning: { label: 'Learning', color: 'yellow' },
  struggling: { label: 'Struggling', color: 'red' },
  mastered: { label: 'Mastered', color: 'green' },
}

export const DUE: StatusLabel = { label: 'Due for review', color: 'orange' }
export const IN_PROGRESS: StatusLabel = { label: 'In progress', color: 'blue' }

export const UNDERSTANDING: Record<UnderstandingStatus, StatusLabel> = {
  understood: { label: 'Understood', color: 'green' },
  unclear: { label: 'Unclear', color: 'yellow' },
  struggling: { label: 'Struggling', color: 'red' },
  unknown: { label: 'Not sure yet', color: 'gray' },
}

export const QUIZ_KIND: Record<QuizKind, StatusLabel> = {
  exam: { label: 'Exam', color: 'purple' },
  review: { label: 'Review', color: 'orange' },
  checkpoint: { label: 'Checkpoint', color: 'blue' },
  placement: { label: 'Placement', color: 'gray' },
}

export const MOVE_LABEL: Record<TeachingMove, string> = {
  intuition: 'Intuition',
  definition: 'Definition',
  worked_example: 'Worked example',
  contrast: 'Contrast',
  apply: 'Apply it',
  explain_back: 'Explain it back',
  predict: 'Predict first',
  big_picture: 'Big picture',
}

/** Score → colour for results: green ≥ 80%, yellow ≥ 50%, red below. */
export function scoreColor(score: number | null): NotionColor {
  if (score === null) return 'gray'
  if (score >= 0.8) return 'green'
  if (score >= 0.5) return 'yellow'
  return 'red'
}
