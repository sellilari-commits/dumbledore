/** Short UI labels the shell shows on toasts and chips (buttons for coach actions, chip text). */
import type { CoachAction } from '@shared/domain'

export function coachActionLabel(action: CoachAction): string {
  switch (action.type) {
    case 'start_roadmap':
      return 'Make a roadmap'
    case 'create_exam':
      return 'Start exam'
    case 'start_review':
      return 'Start review'
    case 'insert_prompt':
      return 'Insert prompt'
    case 'set_focus':
      return 'Focus on it'
    case 'open_subject':
      return 'Open subject'
    case 'adjust_roadmap':
      return 'Update roadmap'
  }
}

/** First ~50 characters of a prompt for the suggestion chip, cut at a word boundary. */
export function chipPreview(text: string, max = 50): string {
  const clean = text.replace(/\s+/g, ' ').trim()
  if (clean.length <= max) return clean
  const cut = clean.slice(0, max + 1)
  const space = cut.lastIndexOf(' ')
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut.slice(0, max)).trimEnd()}…`
}
