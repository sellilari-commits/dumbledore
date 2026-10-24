/**
 * "All extracted text" for one topic on the Memory page: a plain-text file with everything
 * Dumbledore captured about the topic (and the topics under it), grouped by source page, oldest
 * first. Per source: each visit's screen text (the episode, while it is still kept), what was
 * extracted from it (seen, big picture, understanding, open questions) and the notes taken from
 * it. The student's own typed notes come last. Screen text past the retention window is blanked
 * by the extraction worker, so the file says where it is gone. Written to
 * <data dir>/exports/topics/, readable by the owner only, replaced on every open.
 */
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repos } from '@engine/contracts'
import { sourceKey, sourceLabel, subtreeIds } from '@engine/memory/sources'
import type { Encounter, Episode, Id, Note, SourceRef } from '@shared/domain'

type TopicRepos = Pick<Repos, 'subjects' | 'concepts' | 'notes' | 'encounters' | 'episodes'>

interface SourceGroup {
  label: string
  url: string | null
  app: string
  /** Oldest time anything came from it. */
  firstAt: string
  encounters: Encounter[]
  /** Notes with no encounter on this page, or whose encounter is not part of the topic. */
  notes: Note[]
}

const RULE = '─'.repeat(72)

/** "Oct 25, 2026, 14:05" in the machine's locale-neutral English form. */
function when(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function minutes(seconds: number): string {
  const m = Math.round(seconds / 60)
  return m < 1 ? 'under a minute' : m === 1 ? '1 minute' : `${m} minutes`
}

/** Typed in Dumbledore itself (the chat), not read on a page. */
const typed = (note: Note) =>
  note.source.app === 'Dumbledore' || note.source.bundleId === 'org.stuhi.dumbledore'

/** Each line of a block indented, so the file reads as an outline. */
const indent = (text: string, pad = '    ') =>
  text
    .split('\n')
    .map((l) => (l.trim() ? pad + l : ''))
    .join('\n')

/** "12 Oct 2026, 14:05–14:20", the date once when both ends are on the same day. */
function span(fromIso: string, toIso: string): string {
  const from = when(fromIso)
  const to = when(toIso)
  if (from === to) return from
  const [fromDay] = from.split(', ')
  const [toDay, toTime] = to.split(', ')
  return fromDay === toDay && toTime ? `${from}–${toTime}` : `${from} – ${to}`
}

const KIND: Record<Note['kind'], string> = {
  fact: 'Fact',
  definition: 'Definition',
  formula: 'Formula',
  example: 'Example',
  highlight: 'Highlighted',
  question: 'Question',
}

function noteLine(note: Note, pad = '  '): string {
  const mark = typed(note) ? 'Typed' : KIND[note.kind]
  const edited = note.pinned ? ', edited by you' : ''
  return `${pad}• ${note.text}  (${mark}${edited}, ${when(note.createdAt)})`
}

function group(groups: Map<string, SourceGroup>, source: SourceRef, at: string): SourceGroup {
  const key = sourceKey(source)
  let g = groups.get(key)
  if (!g) {
    g = {
      label: sourceLabel(source),
      url: source.url?.trim() || null,
      app: source.app,
      firstAt: at,
      encounters: [],
      notes: [],
    }
    groups.set(key, g)
  }
  if (at < g.firstAt) g.firstAt = at
  return g
}

export interface TopicText {
  /** Topic name, for the file name. */
  name: string
  text: string
}

/** The whole text of a topic; throws when the topic does not exist. */
export function buildTopicText(repos: TopicRepos, conceptId: Id, nowIso: string): TopicText {
  const concept = repos.concepts.get(conceptId)
  if (!concept) throw new Error('That topic no longer exists.')
  const subject = repos.subjects.get(concept.subjectId)
  const all = repos.concepts.listBySubject(concept.subjectId)
  const ids = subtreeIds(concept.id, all)
  const names = new Map(all.map((c) => [c.id, c.name]))
  const sub = all.filter((c) => c.id !== concept.id && ids.has(c.id))

  const notes = repos.notes
    .list({ subjectId: concept.subjectId })
    .filter((n) => n.status === 'active' && n.conceptId !== null && ids.has(n.conceptId))
  const noteEncounters = new Set(notes.map((n) => n.encounterId).filter(Boolean))
  const encounters = repos.encounters
    .list({ subjectId: concept.subjectId })
    .filter((e) => (e.conceptId !== null && ids.has(e.conceptId)) || noteEncounters.has(e.id))
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))

  const groups = new Map<string, SourceGroup>()
  const byEncounter = new Map<Id, Note[]>()
  const shown = new Set(encounters.map((e) => e.id))
  for (const e of encounters) group(groups, e.source, e.createdAt).encounters.push(e)
  const own: Note[] = []
  for (const n of [...notes].sort((a, b) => a.createdAt.localeCompare(b.createdAt))) {
    if (typed(n)) own.push(n)
    else if (n.encounterId && shown.has(n.encounterId))
      byEncounter.set(n.encounterId, [...(byEncounter.get(n.encounterId) ?? []), n])
    else group(groups, n.source, n.createdAt).notes.push(n)
  }

  const episodes = new Map<Id, Episode | null>()
  const episodeOf = (id: Id | null) => {
    if (!id) return null
    if (!episodes.has(id)) episodes.set(id, repos.episodes.get(id))
    return episodes.get(id) ?? null
  }

  let missingText = 0
  const out: string[] = []
  out.push(`${concept.name} — all extracted text`)
  out.push(
    [subject ? `${subject.emoji} ${subject.name}`.trim() : null, `written ${when(nowIso)}`]
      .filter(Boolean)
      .join(' · '),
  )
  out.push('')
  if (concept.summary.trim()) {
    out.push('Big picture')
    out.push(indent(concept.summary.trim(), '  '))
    out.push('')
  }
  if (sub.length) {
    out.push(`Includes: ${sub.map((c) => c.name).join(', ')}`)
    out.push('')
  }

  const sources = [...groups.values()].sort((a, b) => a.firstAt.localeCompare(b.firstAt))
  const body: string[] = []
  sources.forEach((s, i) => {
    body.push(RULE)
    body.push(`Source ${i + 1} of ${sources.length}: ${s.label}`)
    body.push([s.url, s.app, `first seen ${when(s.firstAt)}`].filter(Boolean).join(' · '))
    body.push(RULE)
    const texts = new Set<string>()
    for (const e of s.encounters) {
      body.push('')
      const topic = e.conceptId && names.get(e.conceptId)
      body.push(
        `Visit ${when(e.createdAt)} · ${minutes(e.dwellSeconds)}${topic ? ` · ${topic}` : ''}`,
      )
      const episode = episodeOf(e.episodeId)
      body.push('')
      if (!episode?.text.trim()) {
        missingText++
        body.push('  Screen text: no longer kept.')
      } else if (texts.has(episode.text)) {
        body.push('  Screen text: the same as an earlier visit above.')
      } else {
        texts.add(episode.text)
        body.push(`  Screen text (${episode.app}, ${span(episode.startedAt, episode.endedAt)}):`)
        body.push('')
        body.push(indent(episode.text.trim()))
      }
      body.push('')
      body.push('  What Dumbledore extracted:')
      body.push(`    Seen: ${e.seen}`)
      if (e.bigPicture.trim()) body.push(`    Big picture: ${e.bigPicture}`)
      if (e.topicPath.length) body.push(`    Topic path: ${e.topicPath.join(' › ')}`)
      body.push(
        `    Understanding: ${e.understanding}${e.evidence.trim() ? ` — ${e.evidence}` : ''}`,
      )
      if (e.openQuestions.length) body.push(`    Open questions: ${e.openQuestions.join(' · ')}`)
      if (e.keyTerms.length) body.push(`    Key terms: ${e.keyTerms.join(', ')}`)
      const kept = byEncounter.get(e.id) ?? []
      if (kept.length) {
        body.push('')
        body.push('  Notes from this visit:')
        for (const n of kept) body.push(noteLine(n, '    '))
      }
    }
    if (s.notes.length) {
      body.push('')
      body.push('Other notes from this page:')
      for (const n of s.notes) body.push(noteLine(n))
    }
    body.push('')
  })

  if (missingText > 0) {
    out.push(
      `Screen text is kept for a limited time (Settings → Privacy). For ${
        missingText === 1 ? 'one visit' : `${missingText} visits`
      } it is gone; what Dumbledore extracted from ${missingText === 1 ? 'it' : 'them'} is still here.`,
    )
    out.push('')
  }
  if (sources.length === 0 && own.length === 0) {
    out.push('Nothing was captured about this topic yet.')
    out.push('')
  }
  out.push(...body)
  if (own.length) {
    out.push(RULE)
    out.push('Your own notes')
    out.push(RULE)
    for (const n of own) out.push(noteLine(n))
    out.push('')
  }
  return { name: concept.name, text: `${out.join('\n').trimEnd()}\n` }
}

/** "Carbocation stability" → "carbocation-stability". */
export function topicFileName(name: string, conceptId: Id): string {
  const slug = name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
  return `${slug || 'topic'}-${conceptId.replace(/[^\w-]/g, '')}.txt`
}

/** Writes the topic's text under `<dir>/topics/` (0700 dir, 0600 file); returns the path. */
export function writeTopicText(dir: string, conceptId: Id, topic: TopicText): string {
  const folder = join(dir, 'topics')
  mkdirSync(folder, { recursive: true, mode: 0o700 })
  const file = join(folder, topicFileName(topic.name, conceptId))
  writeFileSync(file, topic.text, { mode: 0o600 })
  chmodSync(file, 0o600)
  return file
}
