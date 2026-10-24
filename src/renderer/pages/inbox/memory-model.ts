/**
 * Pure shaping for the Memory page: the topic tree per subject with notes grouped by the page they
 * came from, the Recent timeline (by day, then by page), source links (http/https only) and the
 * search filter. No React here, so it is unit-tested directly.
 */
import type { Concept, Note, SubjectSummary } from '@shared/domain'
import type { SubjectTree } from '@shared/state'

export type MemoryView = 'topics' | 'recent'

/** Where a note came from: a clickable page, or just the app (PDFs, desktop apps). */
export interface SourceLink {
  label: string
  href: string | null
  /** The app it was read in, when that isn't already the label. */
  app: string | null
}

const HTTP = /^https?:\/\//i

/** Strips browser and profile chrome from a window title: "X - Wikipedia - Google Chrome - Ilari". */
export function cleanTitle(title: string | null, app: string): string | null {
  if (!title) return null
  let t = title
  for (const suffix of [app, 'Google Chrome', 'Safari', 'Arc', 'Firefox', 'Microsoft Edge']) {
    const i = t.lastIndexOf(` - ${suffix}`)
    if (i > 0) t = t.slice(0, i)
  }
  return t.trim() || null
}

export function sourceLink(note: Pick<Note, 'source'>): SourceLink {
  const { url, title, app } = note.source
  const label = cleanTitle(title, app) ?? app
  return { label, href: url && HTTP.test(url) ? url : null, app: label === app ? null : app }
}

/** Short relative time: "now", "5 min", "2 h", "3 d", then a date. */
export function shortAgo(iso: string, now = Date.now()): string {
  const diff = Math.max(0, now - new Date(iso).getTime())
  const min = Math.round(diff / 60_000)
  if (min < 1) return 'now'
  if (min < 60) return `${min} min`
  const h = Math.round(min / 60)
  if (h < 24) return `${h} h`
  const d = Math.round(h / 24)
  if (d < 7) return `${d} d`
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })
}

/** Notes that came from the same page, the page shown once. */
export interface PageGroup {
  key: string
  source: SourceLink
  notes: Note[]
  /** Newest note in the group. */
  at: string
}

const pageKey = (n: Note) => n.source.url ?? `${n.source.app}|${n.source.title ?? ''}`

/** Groups notes by page, newest page first, notes newest first inside each page. */
export function groupByPage(notes: Note[]): PageGroup[] {
  const groups = new Map<string, PageGroup>()
  for (const n of [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const key = pageKey(n)
    const g = groups.get(key)
    if (g) g.notes.push(n)
    else groups.set(key, { key, source: sourceLink(n), notes: [n], at: n.createdAt })
  }
  return [...groups.values()]
}

export interface TopicNode {
  concept: Concept
  depth: number
  pages: PageGroup[]
  noteCount: number
}

export interface SubjectSection {
  subject: SubjectSummary
  topics: TopicNode[]
  /** Notes in the subject not placed on a topic yet. */
  unplaced: PageGroup[]
}

function depthOf(c: Concept, byId: Map<string, Concept>): number {
  let d = 0
  let p = c.parentId ? byId.get(c.parentId) : undefined
  while (p && d < 6) {
    d++
    p = p.parentId ? byId.get(p.parentId) : undefined
  }
  return d
}

/**
 * A topic's sources as the tree may send them (additive `sources` field from the memory cleanup
 * work). Missing → derived from the notes' own source.
 */
export interface TreeSource {
  title: string | null
  url: string | null
  app: string
  lastSeenAt: string | null
  noteCount?: number
}

/**
 * The topic's sources, each with its notes: the tree's `sources` when present (their order and
 * titles win, notes attached by url, then title), else the notes grouped by page.
 */
export function topicSources(notes: Note[], sources?: TreeSource[] | null): PageGroup[] {
  const fromNotes = groupByPage(notes)
  if (!sources || sources.length === 0) return fromNotes
  const used = new Set<string>()
  const out: PageGroup[] = sources.map((src, i) => {
    const link = sourceLink({
      source: { app: src.app, bundleId: null, url: src.url, title: src.title },
    })
    const match = fromNotes.find(
      (g) =>
        !used.has(g.key) &&
        ((src.url && g.notes[0]?.source.url === src.url) ||
          (!src.url && g.source.label === link.label)),
    )
    if (match) used.add(match.key)
    return {
      key: match?.key ?? `src-${i}-${src.url ?? link.label}`,
      source: link,
      notes: match?.notes ?? [],
      at: match?.at ?? src.lastSeenAt ?? '',
    }
  })
  for (const g of fromNotes) if (!used.has(g.key)) out.push(g)
  return out
}

export function buildSection(subject: SubjectSummary, tree: SubjectTree): SubjectSection {
  const byId = new Map(tree.concepts.map((n) => [n.concept.id, n.concept]))
  return {
    subject,
    topics: tree.concepts.map((node) => {
      const { concept, notes } = node
      const sources = (node as { sources?: TreeSource[] }).sources
      return {
        concept,
        depth: depthOf(concept, byId),
        pages: topicSources(notes, sources),
        noteCount: notes.length,
      }
    }),
    unplaced: groupByPage(tree.unplaced),
  }
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD')

/** Keeps notes matching the query (text, keywords, page title); topics match by name too. */
export function filterSection(section: SubjectSection, query: string): SubjectSection | null {
  const q = norm(query.trim())
  if (!q) return section
  const hit = (n: Note) =>
    norm(n.text).includes(q) ||
    n.keywords.some((k) => norm(k).includes(q)) ||
    norm(n.source.title ?? '').includes(q)
  const keepPages = (pages: PageGroup[]) =>
    pages
      .map((p) => ({ ...p, notes: p.notes.filter(hit) }))
      .filter((p) => p.notes.length > 0 || norm(p.source.label).includes(q))
  const topics = section.topics
    .map((t) =>
      norm(t.concept.name).includes(q) ? t : { ...t, pages: keepPages(t.pages), noteCount: 0 },
    )
    .filter((t) => norm(t.concept.name).includes(q) || t.pages.length > 0)
  const unplaced = keepPages(section.unplaced)
  if (topics.length === 0 && unplaced.length === 0 && !norm(section.subject.name).includes(q))
    return null
  return { ...section, topics, unplaced }
}

export function matchesNote(n: Note, query: string): boolean {
  const q = norm(query.trim())
  if (!q) return true
  return (
    norm(n.text).includes(q) ||
    n.keywords.some((k) => norm(k).includes(q)) ||
    norm(n.source.title ?? '').includes(q)
  )
}

/** One page in the Recent timeline: what was saved from it and where it went. */
export interface RecentEntry {
  key: string
  source: SourceLink
  at: string
  notes: Note[]
  /** "Machine Learning › Artificial neurons", or "Loose notes". */
  places: string[]
}

export interface RecentDay {
  label: string
  entries: RecentEntry[]
}

export function dayLabel(iso: string, now = new Date()): string {
  const d = new Date(iso)
  const start = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const days = Math.round((start(now) - start(d)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })
}

/**
 * The Recent view: every note (placed or loose), grouped by day and then by page, newest first.
 * `placeOf` names where a note lives ("Subject › Topic", or null for a loose note).
 */
export function recentTimeline(
  notes: Note[],
  placeOf: (n: Note) => string | null,
  now = new Date(),
): RecentDay[] {
  const days: RecentDay[] = []
  for (const group of groupByDay(notes, now)) {
    const entries = groupByPage(group.notes).map((p) => {
      const places = [...new Set(p.notes.map((n) => placeOf(n) ?? 'Loose notes'))]
      return { key: `${group.label}|${p.key}`, source: p.source, at: p.at, notes: p.notes, places }
    })
    days.push({ label: group.label, entries })
  }
  return days
}

function groupByDay(notes: Note[], now: Date): { label: string; notes: Note[] }[] {
  const out: { label: string; notes: Note[] }[] = []
  for (const n of [...notes].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const label = dayLabel(n.createdAt, now)
    const last = out.at(-1)
    if (last && last.label === label) last.notes.push(n)
    else out.push({ label, notes: [n] })
  }
  return out
}

/** "2 sources" / "1 source". */
export const sourcesCount = (n: number) => `${n} source${n === 1 ? '' : 's'}`

/** "3 notes" / "1 note". */
export const notesCount = (n: number) => `${n} note${n === 1 ? '' : 's'}`

/** A note written by the student (typed in Dumbledore), not taken from a page. */
export const isTyped = (n: Note) =>
  n.pinned && n.kind !== 'highlight' && n.source.app === 'Dumbledore'
