/**
 * Names a subject after its field (cold start, PLAN R40): "How do SN1 and SN2 reactions differ?"
 * → "Organic Chemistry" 🧪, without an LLM call. A keyword table maps typical terms to a field;
 * an explicit field name ("I'm studying organic chemistry", as the roadmapper's drafts often say)
 * counts most. Used on the student's text before planning and on the plan (title, goal, concepts,
 * drafts) after it. When no field is recognised the caller keeps the topic name.
 */
import type { Roadmap, Subject } from '@shared/domain'
import type { Repos } from '../../contracts'
import type { EngineBus } from '../../events'
import { pickSubjectEmoji } from '../../subjects/emoji'
import { isLearn } from './roadmap-ops'
import { FIELDS, type Field } from './subject-fields'

export type { Field } from './subject-fields'

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const termRe = (term: string, whole: boolean) =>
  new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRe(term.toLowerCase())}${whole ? '(?![\\p{L}\\p{N}])' : ''}`,
    'iu',
  )

const MATCHERS = FIELDS.map((field) => ({
  field,
  name: termRe(field.name, true),
  keywords: field.keywords.map((k) =>
    k.endsWith('$') ? termRe(k.slice(0, -1), true) : termRe(k, false),
  ),
}))

/** The field the texts are most about, or null when no term of any field shows up. */
export function detectField(texts: readonly string[]): Field | null {
  const text = texts.join('\n')
  let best: { field: Field; score: number } | null = null
  for (const m of MATCHERS) {
    const score = (m.name.test(text) ? 3 : 0) + m.keywords.filter((re) => re.test(text)).length
    if (score > 0 && (!best || score > best.score)) best = { field: m.field, score }
  }
  return best?.field ?? null
}

/** An existing subject for the field: its own name first, then an alias (e.g. "Chemistry"). */
export function findFieldSubject(repos: Repos, field: Field, exceptId?: string): Subject | null {
  for (const name of [field.name, ...field.aliases]) {
    const found = repos.subjects.findByName(name)
    if (found && found.id !== exceptId && found.status !== 'archived') return found
  }
  return null
}

/** Name and emoji for a new subject: the field when recognised, else the topic name. */
export function newSubjectName(text: string, topic: string): { name: string; emoji: string } {
  const field = detectField([text])
  if (field) return { name: field.name, emoji: field.emoji }
  const emoji = pickSubjectEmoji(topic)
  return { name: topic, emoji }
}

/** What the roadmapper wrote, as text to look for the field in. */
export function planTexts(roadmap: Roadmap): string[] {
  return [
    roadmap.title,
    roadmap.goal,
    ...roadmap.items.flatMap((i) => (isLearn(i) ? [i.title, ...i.concepts, i.promptDraft] : [])),
  ]
}

/**
 * After planning, a subject this cold start created under a topic name gets its field's name
 * and emoji from the plan, or (when the student already has that field) is folded into the
 * existing subject. Returns the roadmap with its final subjectId, and whether anything changed.
 */
export function nameFromPlan(
  repos: Repos,
  subject: Subject,
  roadmap: Roadmap,
): { roadmap: Roadmap; changed: boolean } {
  const field = detectField(planTexts(roadmap))
  if (!field) {
    if (subject.emoji !== pickSubjectEmoji('')) return { roadmap, changed: false }
    const emoji = pickSubjectEmoji([subject.name, roadmap.title].join(' '))
    if (emoji === subject.emoji) return { roadmap, changed: false }
    repos.subjects.update(subject.id, { emoji })
    return { roadmap, changed: true }
  }
  const existing = findFieldSubject(repos, field, subject.id)
  if (existing) {
    if (existing.status !== 'active') repos.subjects.update(existing.id, { status: 'active' })
    repos.subjects.merge(subject.id, existing.id)
    return { roadmap: { ...roadmap, subjectId: existing.id }, changed: true }
  }
  repos.subjects.update(subject.id, { name: field.name, emoji: field.emoji })
  return { roadmap, changed: true }
}

/** `nameFromPlan` that never costs the student the roadmap, and announces a change. */
export function refineNewSubject(
  deps: { repos: Repos; bus: EngineBus },
  subject: Subject,
  roadmap: Roadmap,
): Roadmap {
  try {
    const named = nameFromPlan(deps.repos, subject, roadmap)
    if (named.changed) {
      const ids = [...new Set([subject.id, named.roadmap.subjectId])]
      deps.bus.emit('memory:changed', { scope: 'subjects', ids })
    }
    return named.roadmap
  } catch (error) {
    console.warn('[study] could not name the new subject', error)
    return roadmap
  }
}
