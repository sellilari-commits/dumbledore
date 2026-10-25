/**
 * Open questions of a subject, for everything that aims at them (outline, roadmap planning, the
 * tap's prompt, Your gaps): first what the student asked Dumbledore or said they don't get
 * (active 'question' notes, newest first), then what they wondered while studying (encounters).
 */
import type { Id, Note } from '@shared/domain'
import type { Repos } from '../contracts'

/** The subject's question notes, newest first. */
export function askedQuestions(repos: Pick<Repos, 'notes'>, subjectId: Id): Note[] {
  return repos.notes
    .list({ subjectId, status: 'active' })
    .filter((n) => n.kind === 'question')
    .reverse()
}

export function openQuestionsOf(
  repos: Pick<Repos, 'notes' | 'encounters'>,
  subjectId: Id,
  limit: number,
): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  const all = [
    ...askedQuestions(repos, subjectId).map((n) => n.text),
    ...repos.encounters.openQuestions(subjectId, limit),
  ]
  for (const q of all) {
    const key = q.trim().toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(q.trim())
    if (out.length >= limit) break
  }
  return out
}
