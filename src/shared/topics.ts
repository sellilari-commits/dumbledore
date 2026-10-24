/**
 * Topics: the level right under a subject (its top-level concepts), across every subject the
 * student has gone through (active and suggested). Shared by the mini panel and
 * the right-⌥ tap so both agree on the current topic: the locked one (settings.focusTopicId) while
 * it still exists, else the topic that most recently got new information.
 */
import type { Concept, Id, Subject } from './domain'

export interface Topic {
  id: Id
  name: string
  subjectId: Id
  subjectName: string
  lastSeenAt: string | null
  /** The subject's name, set only when another subject has a topic with the same name. */
  subjectLabel: string | null
}

type SubjectLike = Pick<Subject, 'id' | 'name' | 'status'>

/** The subjects whose topics count: everything the student has gone through, not archived. */
export function topicSubjects<S extends SubjectLike>(subjects: readonly S[]): S[] {
  return subjects.filter((s) => s.status === 'active' || s.status === 'suggested')
}

/** Top-level concepts: no parent, or a parent outside the list. */
export function topLevel(concepts: readonly Concept[]): Concept[] {
  const ids = new Set(concepts.map((c) => c.id))
  return concepts.filter((c) => c.parentId === null || !ids.has(c.parentId))
}

const nameKey = (name: string) => name.trim().toLowerCase()

/** Every topic of the counted subjects, newest information first (never seen last). */
export function listTopics(
  subjects: readonly SubjectLike[],
  conceptsOf: (subjectId: Id) => readonly Concept[],
): Topic[] {
  const topics: Topic[] = topicSubjects(subjects).flatMap((s) =>
    topLevel(conceptsOf(s.id)).map((c) => ({
      id: c.id,
      name: c.name,
      subjectId: s.id,
      subjectName: s.name,
      lastSeenAt: c.lastSeenAt,
      subjectLabel: null,
    })),
  )
  const subjectsByName = new Map<string, Set<Id>>()
  for (const t of topics) {
    const set = subjectsByName.get(nameKey(t.name)) ?? new Set<Id>()
    set.add(t.subjectId)
    subjectsByName.set(nameKey(t.name), set)
  }
  for (const t of topics) {
    if ((subjectsByName.get(nameKey(t.name))?.size ?? 0) > 1) t.subjectLabel = t.subjectName
  }
  return topics.sort(
    (a, b) =>
      (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name),
  )
}

/** The locked topic while it exists, else the newest one (null when there are none). */
export function currentTopic(topics: readonly Topic[], lockedId: Id | null): Topic | null {
  const locked = lockedId ? topics.find((t) => t.id === lockedId) : undefined
  return locked ?? topics[0] ?? null
}
