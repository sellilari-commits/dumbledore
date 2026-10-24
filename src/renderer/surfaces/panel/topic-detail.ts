/**
 * Read model for a topic's detail in the mini panel: the roadmap that covers the topic (if any)
 * with a plain state per step, and the topic's flags — the passages the student highlighted on
 * screen and the notes they typed themselves — newest first. Pure, so the panel stays a view.
 */
import type { Concept, Id, Note, Roadmap, RoadmapItem } from '@shared/domain'
import type { SubjectTree } from '@shared/state'

/** A step's state as the panel shows it: done only once the AI has answered (c2961c6). */
export type StepState = 'done' | 'waiting' | 'current' | 'skipped' | 'upcoming'

const key = (s: string) => s.trim().toLowerCase()

/** The topic and every concept under it. */
export function topicConceptIds(concepts: readonly Concept[], topicId: Id): Set<Id> {
  const ids = new Set<Id>([topicId])
  let grew = true
  while (grew) {
    grew = false
    for (const c of concepts) {
      if (c.parentId !== null && ids.has(c.parentId) && !ids.has(c.id)) {
        ids.add(c.id)
        grew = true
      }
    }
  }
  return ids
}

const itemNames = (item: RoadmapItem): string[] =>
  item.kind === 'learn' ? item.concepts : item.covers

/**
 * The subject's roadmap when it covers this topic: one of its steps teaches or tests the topic
 * or a concept under it, or its title or goal names the topic (a roadmap started from a locked
 * topic). Otherwise null.
 */
export function topicRoadmap(
  roadmap: Roadmap | null,
  topicName: string,
  conceptNames: readonly string[],
): Roadmap | null {
  if (!roadmap) return null
  const names = new Set([topicName, ...conceptNames].map(key))
  if (roadmap.items.some((item) => itemNames(item).some((n) => names.has(key(n))))) return roadmap
  const topic = key(topicName)
  return key(roadmap.title).includes(topic) || key(roadmap.goal).includes(topic) ? roadmap : null
}

export function stepState(item: RoadmapItem): StepState {
  if (item.status === 'done') return 'done'
  if (item.status === 'skipped') return 'skipped'
  if (item.status === 'current') {
    return item.kind === 'learn' && item.promptSent !== null ? 'waiting' : 'current'
  }
  return 'upcoming'
}

export const STEP_LABEL: Record<StepState, string> = {
  done: 'Done',
  waiting: 'Waiting for the answer',
  current: 'Now',
  skipped: 'Skipped',
  upcoming: 'Next up',
}

/** Notes the student wrote in Dumbledore itself (typed in the chat), as opposed to read ones. */
const typedByStudent = (note: Note) =>
  note.source.bundleId === 'org.stuhi.dumbledore' || key(note.source.app) === 'dumbledore'

/** A flag: a passage the student highlighted, or a note they typed. */
export const isFlag = (note: Note) =>
  note.status === 'active' && (note.kind === 'highlight' || typedByStudent(note))

/** The topic's flags (its own and its subtopics'), newest first. */
export function topicFlags(tree: SubjectTree | undefined, ids: ReadonlySet<Id>): Note[] {
  if (!tree) return []
  return tree.concepts
    .filter((node) => ids.has(node.concept.id))
    .flatMap((node) => node.notes)
    .filter(isFlag)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

const SITE_SEP = /\s[–—-]\s/

/** Where a flag came from, short: the site after "Title – Site", else the app. */
export function sourceLabel(note: Note): string {
  if (typedByStudent(note)) return 'Your note'
  const parts = (note.source.title ?? '').split(SITE_SEP)
  const site = parts.length > 1 ? parts.at(-1)?.trim() : null
  return site || note.source.title?.trim() || note.source.app
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "just now", "12 min ago", "5 h ago", "3 d ago". */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso))
  if (ms < MINUTE) return 'just now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min ago`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h ago`
  return `${Math.floor(ms / DAY)} d ago`
}
