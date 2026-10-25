/**
 * Read model for a topic's detail in the mini panel: its subtopics (child concepts, as a tree),
 * the roadmap that covers the topic (if any) with a plain state per step, the student's own notes
 * on it (what they highlighted on screen and what they typed) and what Dumbledore extracted about
 * it (facts from pages, outline passages), newest first. Only the topic's own notes: a
 * subtopic's are in its own detail. Pure, so the panel stays a view.
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

/** The concept's direct children, newest information first (never seen last), then by name. */
export function subtopicsOf(concepts: readonly Concept[], topicId: Id): Concept[] {
  return concepts
    .filter((c) => c.parentId === topicId && c.id !== topicId)
    .sort(
      (a, b) =>
        (b.lastSeenAt ?? '').localeCompare(a.lastSeenAt ?? '') || a.name.localeCompare(b.name),
    )
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

/**
 * A passage the long-press outline marked as worth reading. outline-flow saves those as kind
 * 'highlight' with keywords [why] and no encounter; the student's own highlights come from
 * extraction with an encounter and no keywords, so the two can be told apart without a marker.
 */
export const isOutlinePassage = (note: Note) =>
  note.kind === 'highlight' && note.encounterId === null && note.keywords.length > 0

const shown = (note: Note) => note.status === 'active' && note.kind !== 'misconception'

/** The student's own: a passage they highlighted, or a note they typed or a question they asked. */
export const isYourNote = (note: Note) =>
  shown(note) && (typedByStudent(note) || (note.kind === 'highlight' && !isOutlinePassage(note)))

/** What Dumbledore extracted: facts and claims read from pages, and outline passages. */
export const isExtracted = (note: Note) => shown(note) && !isYourNote(note)

const newestFirst = (a: Note, b: Note) => b.createdAt.localeCompare(a.createdAt)

function notesOn(tree: SubjectTree | undefined, ids: ReadonlySet<Id>): Note[] {
  if (!tree) return []
  return tree.concepts.filter((node) => ids.has(node.concept.id)).flatMap((node) => node.notes)
}

/** The concepts' notes, split into the student's own and the extracted ones, newest first. */
export function topicNotes(
  tree: SubjectTree | undefined,
  ids: ReadonlySet<Id>,
): { yours: Note[]; extracted: Note[] } {
  const notes = notesOn(tree, ids).sort(newestFirst)
  return { yours: notes.filter(isYourNote), extracted: notes.filter(isExtracted) }
}

const SITE_SEP = /\s[–—-]\s/

/** Browser names as they end a window title ("… - Google Chrome", "… — Mozilla Firefox"). */
const BROWSERS = new Set(
  [
    'Google Chrome',
    'Google Chrome Beta',
    'Google Chrome Canary',
    'Chrome',
    'Chromium',
    'Safari',
    'Safari Technology Preview',
    'Arc',
    'Microsoft Edge',
    'Microsoft\u200b Edge',
    'Edge',
    'Mozilla Firefox',
    'Mozilla Firefox Private Browsing',
    'Firefox',
    'Firefox Developer Edition',
    'Brave',
    'Brave Browser',
    'Opera',
    'Vivaldi',
    'Orion',
    'Zen Browser',
    'Dia',
  ].map(key),
)

/**
 * The window title without the browser's own suffix: "Page - Site - Google Chrome - Ilari
 * (stuhi.org)" → ["Page", "Site"]. The browser name and anything after it (a profile) go; so does
 * the app's own name at the end.
 */
function titleParts(title: string, app: string): string[] {
  const parts = title
    .split(SITE_SEP)
    .map((p) => p.trim())
    .filter(Boolean)
  const isBrowser = (p: string) => BROWSERS.has(key(p)) || key(p) === key(app)
  const at = parts.findIndex((p, i) => i > 0 && isBrowser(p))
  if (at > 0) return parts.slice(0, at)
  return isBrowser(parts[0] ?? '') ? [] : parts
}

/** Where a flag came from, short: the site after "Title – Site" (browser and profile left out), else the page, else the app. */
export function sourceLabel(note: Note): string {
  if (typedByStudent(note)) return 'Your note'
  const parts = titleParts(note.source.title ?? '', note.source.app)
  return parts.at(-1) || note.source.app
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** "now", "12 min", "5 h", "3 d" (the quiet line under a note: "Wikipedia · 17 min"). */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const ms = Math.max(0, now - Date.parse(iso))
  if (ms < MINUTE) return 'now'
  if (ms < HOUR) return `${Math.floor(ms / MINUTE)} min`
  if (ms < DAY) return `${Math.floor(ms / HOUR)} h`
  return `${Math.floor(ms / DAY)} d`
}
