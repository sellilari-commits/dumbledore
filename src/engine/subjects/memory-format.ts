/**
 * Renders a subject's human-readable "memory file" (PLAN §6.7): a header with goal, mastery and
 * last study date, the concept tree with status, mastery and next review and each concept's notes
 * (docs/NOTES.md), the subject's unplaced notes, and the encounters newest first with Seen / Big
 * picture / Understanding / Open questions. Pure: data in, text out.
 */
import type { Concept, Encounter, MasteryStatus, Note, Quiz, SubjectSummary } from '@shared/domain'
import { struggleReason } from '../queries/struggle'
import { isDateOnly } from '../queries/time'

export interface MemoryFileInput {
  subject: SubjectSummary
  concepts: readonly Concept[]
  /** Newest first. Ignored encounters are skipped. */
  encounters: readonly Encounter[]
  /** Newest first; used to explain struggling concepts. */
  quizzes: readonly Quiz[]
  /** Active notes of the subject, oldest first (shown under their concept). */
  notes?: readonly Note[]
}

export interface MemoryFormatOptions {
  /** IANA zone for dates and times; defaults to the system zone. */
  timeZone?: string
  maxEncounters?: number
}

const STATUS_LABEL: Record<MasteryStatus, string> = {
  new: 'New',
  learning: 'Learning',
  struggling: 'Struggling',
  mastered: 'Mastered',
}

const oneLine = (text: string) => text.replace(/\s+/g, ' ').trim()

function localParts(isoTime: string, timeZone?: string): { date: string; time: string } {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(isoTime))
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? ''
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    time: `${get('hour')}:${get('minute')}`,
  }
}

function shortUrl(url: string): string {
  try {
    const u = new URL(url)
    return `${u.host}${u.pathname === '/' ? '' : u.pathname}`
  } catch {
    return url
  }
}

function headerLine(s: SubjectSummary, tz?: string): string {
  const parts: string[] = []
  const deadline = s.deadline
    ? isDateOnly(s.deadline)
      ? s.deadline
      : localParts(s.deadline, tz).date
    : null
  if (s.goal) parts.push(`Goal: ${oneLine(s.goal)}${deadline ? ` (${deadline})` : ''}`)
  else if (deadline) parts.push(`Deadline: ${deadline}`)
  parts.push(`Mastery ${Math.round(s.mastery * 100)}%`)
  parts.push(
    s.lastStudiedAt ? `Last studied ${localParts(s.lastStudiedAt, tz).date}` : 'Not studied yet',
  )
  if (s.status !== 'active') parts.push(`Status: ${s.status}`)
  return parts.join(' · ')
}

function noteLine(n: Note, indent: string, tz?: string): string {
  const where = n.source.title ? oneLine(n.source.title) : n.source.app
  const label = n.kind === 'highlight' ? 'highlighted, ' : ''
  return `${indent}- “${oneLine(n.text)}” (${label}${where}, ${localParts(n.createdAt, tz).date})`
}

function conceptLines(input: MemoryFileInput, tz?: string): string[] {
  const { concepts } = input
  const notesOf = new Map<string, Note[]>()
  for (const n of input.notes ?? [])
    if (n.conceptId) notesOf.set(n.conceptId, [...(notesOf.get(n.conceptId) ?? []), n])
  if (concepts.length === 0) return ['_No concepts yet._']
  const ids = new Set(concepts.map((c) => c.id))
  const children = new Map<string | null, Concept[]>()
  for (const c of concepts) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null
    children.set(parent, [...(children.get(parent) ?? []), c])
  }
  const lines: string[] = []
  const visited = new Set<string>()
  const walk = (parent: string | null, depth: number) => {
    for (const c of children.get(parent) ?? []) {
      if (visited.has(c.id)) continue
      visited.add(c.id)
      const isGroup = children.has(c.id) && c.status === 'new' && c.mastery === 0 && !c.lastSeenAt
      let line = `${'  '.repeat(depth)}- ${oneLine(c.name)}`
      if (!isGroup) {
        const detail =
          c.status === 'struggling'
            ? struggleReason(c, input.quizzes, input.encounters)
            : c.mastery.toFixed(2)
        line += ` — ${STATUS_LABEL[c.status]} (${detail})`
        if (c.nextReviewAt) line += ` · review due ${localParts(c.nextReviewAt, tz).date}`
      }
      lines.push(line)
      for (const n of notesOf.get(c.id) ?? []) lines.push(noteLine(n, '  '.repeat(depth + 1), tz))
      walk(c.id, depth + 1)
    }
  }
  walk(null, 0)
  return lines
}

function encounterBlock(e: Encounter, tz?: string): string[] {
  const { date, time } = localParts(e.createdAt, tz)
  const where = e.source.url ? shortUrl(e.source.url) : (e.source.title ?? '')
  const head = [`${date} ${time}`, e.source.app, where]
  if (e.dwellSeconds >= 30) head.push(`${Math.max(1, Math.round(e.dwellSeconds / 60))} min`)
  const path = e.topicPath.map(oneLine).join(' › ')
  const big = [path, oneLine(e.bigPicture)].filter(Boolean).join(' — ')
  const lines = [
    `### ${head.filter(Boolean).join(' · ')}`,
    `- **Seen:** ${oneLine(e.seen)}`,
    `- **Big picture:** ${big}`,
    `- **Understanding:** ${e.understanding}${e.evidence.trim() ? ` — ${oneLine(e.evidence)}` : ''}`,
  ]
  if (e.openQuestions.length)
    lines.push(`- **Open questions:** ${e.openQuestions.map(oneLine).join(' · ')}`)
  return lines
}

export function formatMemoryFile(input: MemoryFileInput, opts: MemoryFormatOptions = {}): string {
  const tz = opts.timeZone
  const max = opts.maxEncounters ?? 100
  const encounters = input.encounters.filter((e) => e.inboxState !== 'ignored')
  const shown = encounters.slice(0, max)
  const lines = [
    `# ${input.subject.emoji} ${oneLine(input.subject.name)}`,
    headerLine(input.subject, tz),
    '',
    '## Concept map',
    ...conceptLines(input, tz),
  ]
  const ids = new Set(input.concepts.map((c) => c.id))
  const unplaced = (input.notes ?? []).filter((n) => !n.conceptId || !ids.has(n.conceptId))
  if (unplaced.length) lines.push('', '## Other notes', ...unplaced.map((n) => noteLine(n, '', tz)))
  lines.push('', '## Encounters')
  if (shown.length === 0) lines.push('_Nothing seen yet._')
  shown.forEach((e, i) => {
    if (i > 0) lines.push('')
    lines.push(...encounterBlock(e, tz))
  })
  if (encounters.length > shown.length) {
    lines.push('', `_…and ${encounters.length - shown.length} older encounters._`)
  }
  return `${lines.join('\n')}\n`
}
