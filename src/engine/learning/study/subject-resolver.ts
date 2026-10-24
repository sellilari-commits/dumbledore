/**
 * Cold start (F5, PLAN R40): turns free text like "I don't get the Calvin cycle" into a subject.
 * Order: exact subject name → a known subject named in the text → a known concept named in the
 * text (its subject) → the student's subject for the field the text is about (subject-naming.ts)
 * → a new active subject named after that field ("Organic Chemistry" 🧪), else after the topic
 * ("SN1 and SN2 reactions"). The study service refines a topic-named subject from the plan.
 */
import type { Subject } from '@shared/domain'
import type { Repos } from '../../contracts'
import { detectField, findFieldSubject, newSubjectName } from './subject-naming'
import { norm } from './text'

const LEAD_INS: RegExp[] = [
  /^(hey|hi|ok|okay|so|please|pls)[,!.\s]+/i,
  /^i\s+(really\s+|still\s+)?(don'?t|do not|can'?t|cannot)\s+(get|understand|grasp|follow)\s+/i,
  /^i\s+(want|need|would like|'?d like)\s+to\s+(learn|understand|study|know|review|master|get better at|figure out)\s+((more\s+)?about\s+)?/i,
  /^i'?m\s+(confused|stuck|struggling|lost)\s+(about|with|on|by)\s+/i,
  /^(can you\s+|could you\s+)?(help me|teach me|explain|walk me through|quiz me on|show me)\s+((to\s+)?(learn|understand|study|with|about|on)\s+)?/i,
  /^(how|why|what|when|where|who)('s|’s)\s+/i,
  /^(how|why|what|when|where)\s+(do|does|did|is|are|was|were|can|should)\s+/i,
  /^(the\s+)?(main\s+|key\s+)?differences?\s+(between|of)\s+/i,
  /^(learn|study|understand|review|explain)(ing)?\s+((more\s+)?about\s+)?/i,
]
const TAIL_CUTS =
  /\s+(for|because|so that|so i|before|by|in order to|since|which|that i)\s+.*$|[,;:(—–].*$/i
const TRAILING =
  /\s+(work|works|working|happen|happens|mean|means|function|functions|differ|differs|compare|compares|relate|relates|interact|interacts|occur|occurs|matter|matters|vary|varies)$/i
const ARTICLE = /^(the|a|an|my|our|this|these|those)\s+/i

/** "I don't get the Calvin cycle?" → "Calvin cycle". Falls back to the trimmed text. */
export function deriveSubjectName(text: string): string {
  let t = text
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[?!.]+$/, '')
  for (let pass = 0; pass < 3; pass++) {
    for (const re of LEAD_INS) t = t.replace(re, '')
  }
  t = t.replace(TAIL_CUTS, '').replace(TRAILING, '').replace(ARTICLE, '').trim()
  t = t.replace(/[?!.]+$/, '').trim()
  if (t.length < 2) t = text.trim()
  if (t.length > 60)
    t =
      t
        .slice(0, 60)
        .replace(/\s+\S*$/, '')
        .trim() || t.slice(0, 60)
  return t.charAt(0).toUpperCase() + t.slice(1)
}

function mentions(haystack: string, name: string): boolean {
  const n = norm(name)
  if (n.length < 3) return false
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(haystack)
}

export interface ResolvedSubject {
  subject: Subject
  created: boolean
  /** A new subject named after a topic, not a field: worth renaming once the plan is in. */
  topicNamed: boolean
}

export function resolveSubject(repos: Repos, text: string): ResolvedSubject {
  const name = deriveSubjectName(text)
  const candidates = repos.subjects.list({ status: ['active', 'suggested'] })
  const haystack = norm(text)
  const found =
    repos.subjects.findByName(name) ??
    longest(
      candidates.filter((s) => mentions(haystack, s.name)),
      (s) => s.name,
    ) ??
    longest(
      candidates.flatMap((s) =>
        repos.concepts
          .listBySubject(s.id)
          .filter((c) => mentions(haystack, c.name))
          .map((c) => ({ subject: s, name: c.name })),
      ),
      (m) => m.name,
    )?.subject ??
    null
  const field = found ? null : detectField([text])
  const existing = found ?? (field ? findFieldSubject(repos, field) : null)
  if (existing) {
    const subject =
      existing.status === 'active'
        ? existing
        : repos.subjects.update(existing.id, { status: 'active' })
    return { subject, created: false, topicNamed: false }
  }
  const named = newSubjectName(text, name)
  const subject = repos.subjects.create({
    name: named.name,
    emoji: named.emoji,
    status: 'active',
    goal: text.trim().slice(0, 200),
  })
  return { subject, created: true, topicNamed: field === null }
}

function longest<T>(items: T[], key: (item: T) => string): T | null {
  return [...items].sort((a, b) => key(b).length - key(a).length)[0] ?? null
}
