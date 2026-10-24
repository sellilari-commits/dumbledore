/**
 * A subject's study preferences (adjust_roadmap): the LLM's mapping (P14) of "on this subject I
 * want X, not Y" is validated against the concept tree and merged with the wishes stored before.
 * The roadmap context then expands them to sub-concepts: skipped ones leave the study order,
 * focus ones (and their prerequisites) lead it.
 */
import type { Concept } from '@shared/domain'
import type { PreferencesInput, PreferencesOutput } from '../../brain-contract'
import type { StudyPreferences } from '../../contracts'
import { norm, uniqueNames } from './text'

const MAX_NAMES = 10

/** The P14 input for a subject: its concepts (tree order kept) and the wishes stored so far. */
export function preferencesInput(args: {
  subject: { name: string; goal: string | null }
  language: PreferencesInput['language']
  concepts: readonly Concept[]
  current: StudyPreferences | null
  instruction: string
}): PreferencesInput {
  return {
    subject: args.subject,
    language: args.language,
    concepts: args.concepts.map((c) => ({ id: c.id, name: c.name, parentId: c.parentId })),
    current: { focus: args.current?.focus ?? [], skip: args.current?.skip ?? [] },
    instruction: args.instruction,
  }
}

/**
 * Validates the model's answer and merges it into the stored wishes. Unknown concept ids are
 * dropped; a concept the student now wants leaves the skip list and the other way round; a
 * concept named in both new lists counts as wanted (the student mentioned it, so keep it).
 */
export function mergePreferences(args: {
  current: StudyPreferences | null
  mapped: PreferencesOutput
  concepts: readonly Pick<Concept, 'id'>[]
  instruction: string
  nowIso: string
}): StudyPreferences {
  const { mapped } = args
  const known = new Set(args.concepts.map((c) => c.id))
  const valid = (ids: string[]) => [...new Set(ids.filter((id) => known.has(id)))]
  const newFocus = valid(mapped.focus)
  const newSkip = valid(mapped.skip).filter((id) => !newFocus.includes(id))
  const base = mapped.replace ? null : args.current

  const focus = [
    ...(base?.focus ?? []).filter((id) => known.has(id) && !newSkip.includes(id)),
    ...newFocus,
  ]
  const skip = [
    ...(base?.skip ?? []).filter((id) => known.has(id) && !newFocus.includes(id)),
    ...newSkip,
  ]
  const names = (old: string[], add: string[], drop: string[]) =>
    uniqueNames([...old, ...add])
      .filter((n) => !drop.some((d) => norm(d) === norm(n)))
      .slice(-MAX_NAMES)
  const focusNames = names(base?.focusNames ?? [], mapped.focusNames, mapped.skipNames)
  const skipNames = names(base?.skipNames ?? [], mapped.skipNames, mapped.focusNames)

  const previous = base?.instruction.trim()
  const said = args.instruction.trim()
  return {
    instruction: previous && norm(previous) !== norm(said) ? `${previous} · ${said}` : said,
    focus: [...new Set(focus)],
    skip: [...new Set(skip)],
    focusNames,
    skipNames,
    updatedAt: args.nowIso,
  }
}

/** Ids plus all their descendants: wishing for a topic covers what sits under it. */
export function withDescendants(ids: readonly string[], concepts: readonly Concept[]): Set<string> {
  const children = new Map<string, string[]>()
  for (const c of concepts)
    if (c.parentId) children.set(c.parentId, [...(children.get(c.parentId) ?? []), c.id])
  const out = new Set<string>()
  const stack = [...ids]
  while (stack.length > 0) {
    const id = stack.pop() as string
    if (out.has(id)) continue
    out.add(id)
    stack.push(...(children.get(id) ?? []))
  }
  return out
}
