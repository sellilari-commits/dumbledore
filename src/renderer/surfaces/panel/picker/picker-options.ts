/**
 * The picker's options as one flat, keyboard-navigable list: "Learn “<typed text>”" first when
 * something is typed, then each subject followed by its extracted study questions — filtered by
 * the typed text — and how each option starts a session.
 */
import type { SubjectSummary } from '@shared/domain'
import type { PickerData, StartSessionInput } from '@shared/state'

export type PickerOption =
  | { kind: 'custom'; id: string; text: string }
  | { kind: 'subject'; id: string; subject: SubjectSummary; resume: boolean }
  | { kind: 'question'; id: string; subject: SubjectSummary; question: string }

export function buildOptions(data: PickerData | undefined, query: string): PickerOption[] {
  const text = query.trim()
  const q = text.toLowerCase()
  const out: PickerOption[] = []
  if (text) out.push({ kind: 'custom', id: 'custom', text })
  for (const row of data?.subjects ?? []) {
    const { subject } = row
    const subjectHit = !q || subject.name.toLowerCase().includes(q)
    const questions = subjectHit
      ? row.questions
      : row.questions.filter((x) => x.toLowerCase().includes(q))
    if (!subjectHit && questions.length === 0) continue
    out.push({ kind: 'subject', id: `s:${subject.id}`, subject, resume: row.hasActiveRoadmap })
    questions.forEach((question, i) => {
      out.push({ kind: 'question', id: `q:${subject.id}:${i}`, subject, question })
    })
  }
  return out
}

export function toStartInput(option: PickerOption): StartSessionInput {
  switch (option.kind) {
    case 'custom':
      return { subjectId: null, goal: option.text, question: null }
    case 'subject':
      return { subjectId: option.subject.id, goal: null, question: null }
    case 'question':
      return { subjectId: option.subject.id, goal: null, question: option.question }
  }
}

/** Index after an arrow key, clamped to the list (no wrap, like Spotlight). */
export function moveIndex(index: number, delta: number, length: number): number {
  if (length === 0) return 0
  return Math.min(length - 1, Math.max(0, index + delta))
}
