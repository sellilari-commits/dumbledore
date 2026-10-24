/**
 * Sources of a topic (Ilari, 2026-10-25): a topic is the unit and gathers every page it was read
 * in. A source is one page (its url without #fragment), else one app window title, derived from
 * the topic's notes (its own and its subtree's) and their encounters.
 */
import type { Concept, Id, Note, SourceRef } from '@shared/domain'
import type { TopicSource } from '@shared/state'
import type { Repos } from '../contracts'

export type { TopicSource }

/** A page's address without its #fragment, so one page is one source. */
export function pageKeyOfUrl(url: string | null | undefined): string | null {
  const u = url?.trim()
  if (!u) return null
  return u.replace(/#.*$/, '')
}

/** Browser and app suffixes that window titles carry ("… - Google Chrome - Ilari (x)"). */
const TITLE_TAIL = /\s[-–—|]\s(Google Chrome|Safari|Firefox|Arc|Microsoft Edge|Brave Browser)\b.*$/i

/** A short, readable name for where a note was read. */
export function sourceLabel(source: Pick<SourceRef, 'title' | 'app' | 'url'>): string {
  const title = source.title?.replace(TITLE_TAIL, '').replace(/\s+/g, ' ').trim()
  if (title) return title.slice(0, 80)
  const host = source.url ? /^[a-z]+:\/\/([^/]+)/i.exec(source.url)?.[1] : null
  return (host ?? source.app).slice(0, 80)
}

/** One key per page (url), else per app + title. */
export function sourceKey(source: Pick<SourceRef, 'title' | 'app' | 'url'>): string {
  return pageKeyOfUrl(source.url) ?? `app:${source.app}|${sourceLabel(source)}`
}

/** The concept and all its descendants. */
export function subtreeIds(conceptId: Id, all: readonly Concept[]): Set<Id> {
  const out = new Set<Id>([conceptId])
  for (let grew = true; grew; ) {
    grew = false
    for (const c of all)
      if (c.parentId && out.has(c.parentId) && !out.has(c.id)) {
        out.add(c.id)
        grew = true
      }
  }
  return out
}

/** Sources of a set of notes, newest first. */
export function sourcesOfNotes(notes: readonly Note[]): TopicSource[] {
  const byKey = new Map<string, TopicSource>()
  for (const n of notes) {
    if (n.source.app === 'Dumbledore') continue // typed notes and coach questions: not a page
    const key = sourceKey(n.source)
    const seenAt = n.updatedAt // never before createdAt
    const s = byKey.get(key)
    if (s) {
      s.noteCount++
      s.noteIds.push(n.id)
      if (seenAt > s.lastSeenAt) s.lastSeenAt = seenAt
    } else {
      byKey.set(key, {
        title: sourceLabel(n.source),
        url: pageKeyOfUrl(n.source.url),
        app: n.source.app,
        lastSeenAt: seenAt,
        noteCount: 1,
        noteIds: [n.id],
      })
    }
  }
  return [...byKey.values()].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
}

/** Every source of a topic: the pages its notes (and its subtree's) were read in. */
export function topicSources(repos: Repos, conceptId: Id): TopicSource[] {
  const concept = repos.concepts.get(conceptId)
  if (!concept) return []
  const ids = subtreeIds(conceptId, repos.concepts.listBySubject(concept.subjectId))
  const notes = repos.notes
    .list({ subjectId: concept.subjectId })
    .filter((n) => n.conceptId !== null && ids.has(n.conceptId))
  return sourcesOfNotes(notes)
}
