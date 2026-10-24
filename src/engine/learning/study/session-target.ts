/**
 * What a `start()` call is about: the subject (picked, named in free text, or the focus subject)
 * and the goal. Free text without a subject is a cold start (F5): find or create the subject.
 */
import type { Roadmap, Subject } from '@shared/domain'
import type { StartSessionInput } from '@shared/state'
import type { Repos } from '../../contracts'
import { StudyError } from './session-state'
import { resolveSubject } from './subject-resolver'
import { norm } from './text'

export interface SessionTarget {
  subject: Subject
  /** The student's own words (goal or picked question); null = "continue this subject". */
  goal: string | null
  question: string | null
  coldStart: boolean
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

export function resolveTarget(repos: Repos, input: StartSessionInput): SessionTarget {
  const goal = clean(input.goal)
  const question = clean(input.question)
  if (input.subjectId) {
    const found = repos.subjects.get(input.subjectId)
    if (!found) throw new StudyError('That subject no longer exists.')
    // Picking a suggested (or archived) subject means the student is studying it now.
    const subject =
      found.status === 'active' ? found : repos.subjects.update(found.id, { status: 'active' })
    return { subject, goal: goal ?? question, question, coldStart: false }
  }
  const text = goal ?? question
  if (text) {
    const { subject } = resolveSubject(repos, text)
    return { subject, goal: text, question, coldStart: true }
  }
  const focusId = repos.settings.get().focusSubjectId
  const focus = focusId ? repos.subjects.get(focusId) : null
  if (focus) return { subject: focus, goal: null, question: null, coldStart: false }
  throw new StudyError('Pick a subject or type what you want to learn.')
}

/**
 * The subject's open (not done) roadmap to resume: the active one first, then the most recently
 * touched. Doesn't rely on timestamp tie-breaking, since parking and planning share a timestamp.
 */
export function openRoadmap(repos: Repos, subjectId: string): Roadmap | null {
  const rank = (r: Roadmap) => (r.status === 'active' ? 0 : 1)
  return (
    repos.roadmaps
      .listBySubject(subjectId)
      .filter((r) => r.status !== 'done')
      .sort(
        (a, b) =>
          rank(a) - rank(b) ||
          b.updatedAt.localeCompare(a.updatedAt) ||
          b.createdAt.localeCompare(a.createdAt),
      )[0] ?? null
  )
}

/** Resume the subject's open roadmap unless the student asked for something else. */
export function shouldResume(active: Roadmap | null, goal: string | null): active is Roadmap {
  if (!active) return false
  return goal === null || norm(active.goal) === norm(goal) || norm(active.title) === norm(goal)
}
