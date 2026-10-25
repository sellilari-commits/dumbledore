/**
 * The chat's working indicator, main side: a short label for what the tool loop is doing right
 * now ("Reading your roadmap…", "Searching the web…"), sent to the Ask bar as 'chat.progress'.
 * `withProgress` wraps a turn's tools so every call says what it is about to do when it starts,
 * and "Thinking…" once it is done (the model reads the result and writes on). The Ask bar shows
 * "Thinking…" from Enter on by itself, so a turn without tools needs no event at all.
 * Labels are by tool, then by the call's kind or act name; anything unknown is "Working on it…".
 */
import type { CoachTools } from '@engine/brain-contract'

export const THINKING_LABEL = 'Thinking…'
export const WORKING_LABEL = 'Working on it…'

const READ: Record<string, string> = {
  subjects: 'Looking at your subjects…',
  subject: 'Looking at your subject…',
  topic: 'Reading the topic…',
  notes: 'Reading your notes…',
  note: 'Reading your notes…',
  roadmaps: 'Reading your roadmap…',
  roadmap: 'Reading your roadmap…',
  roadmap_history: 'Reading your roadmap’s history…',
  quizzes: 'Checking your quizzes…',
  quiz: 'Checking your quizzes…',
  exams: 'Checking your exams…',
  gaps: 'Checking your gaps…',
  encounters: 'Looking through what you’ve read…',
  encounter: 'Looking through what you’ve read…',
  episodes: 'Looking through what you’ve read…',
  assignments: 'Checking your assignments…',
  feedback: 'Reading your feedback…',
  nudges: 'Checking your reminders…',
  chat: 'Reading our chat…',
  profile: 'Reading your profile…',
  settings: 'Checking your settings…',
  session: 'Checking your study session…',
}

const CREATE: Record<string, string> = {
  subject: 'Creating the course…',
  topic: 'Adding the topic…',
  note: 'Updating your notes…',
  roadmap_step: 'Updating your roadmap…',
  feedback: 'Noting your feedback…',
  assignment: 'Adding the assignment…',
}

const UPDATE: Record<string, string> = {
  subject: 'Updating the course…',
  topic: 'Updating the topic…',
  note: 'Updating your notes…',
  roadmap: 'Updating your roadmap…',
  roadmap_step: 'Updating your roadmap…',
  assignment: 'Updating the assignment…',
  settings: 'Updating your settings…',
  profile: 'Updating your profile…',
}

const ACT: Record<string, string> = {
  start_roadmap: 'Planning your roadmap…',
  adjust_roadmap: 'Updating your roadmap…',
  restore_roadmap_version: 'Bringing back that roadmap…',
  create_exam: 'Creating the exam…',
  start_review: 'Starting a review…',
  set_focus: 'Setting your focus…',
  open_subject: 'Opening the subject…',
  open_topic: 'Opening the topic…',
  save_question: 'Saving your question…',
  add_note: 'Updating your notes…',
  write_prompt: 'Writing the prompt…',
  paste_prompt: 'Pasting the prompt…',
  study_now: 'Getting your next step…',
  'session.start': 'Starting your session…',
  'session.next': 'Getting your next step…',
  'session.end': 'Ending your session…',
  'window.open': 'Opening it…',
}

/** A string field of a call's input, or null (the model's input is untrusted and may be anything). */
function field(input: unknown, key: string): string | null {
  if (!input || typeof input !== 'object') return null
  const value = (input as Record<string, unknown>)[key]
  return typeof value === 'string' ? value.trim() : null
}

const pick = (table: Record<string, string>, key: string | null, fallback: string): string =>
  key !== null && Object.hasOwn(table, key) ? (table[key] as string) : fallback

/** The working indicator's label for one tool call. */
export function progressLabel(name: string, input: unknown): string {
  switch (name) {
    case 'read':
      return pick(READ, field(input, 'kind'), 'Looking that up…')
    case 'search':
      return 'Searching your notes…'
    case 'web_search':
      return 'Searching the web…'
    case 'create':
      return pick(CREATE, field(input, 'kind'), 'Saving that…')
    case 'update':
      return pick(UPDATE, field(input, 'kind'), 'Updating that…')
    case 'delete':
      return 'Getting the delete ready…'
    case 'act':
      return pick(ACT, field(input, 'name'), WORKING_LABEL)
    default:
      return WORKING_LABEL
  }
}

/**
 * The turn's tools, saying each step: `emit(label)` when a call starts, THINKING_LABEL when it
 * ends (ok or not). An emit that throws never breaks the call.
 */
export function withProgress(tools: CoachTools, emit: (label: string) => void): CoachTools {
  const say = (label: string) => {
    try {
      emit(label)
    } catch {
      // The indicator is cosmetic: the call goes on.
    }
  }
  return {
    specs: tools.specs,
    async run(name, input) {
      say(progressLabel(name, input))
      try {
        return await tools.run(name, input)
      } finally {
        say(THINKING_LABEL)
      }
    },
  }
}
