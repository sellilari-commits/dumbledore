/**
 * Applies extractor (P1) results to memory: matches or suggests a subject (no duplicates by
 * name), adds encounters with the three parts and their atomic notes (docs/NOTES.md), upserts
 * assignments, counts prompt habits and lets the mastery model react. Pure Repos work, run
 * inside one transaction by the worker.
 *
 * Structuring is the LLM's (A-MEM style): it places each note on an existing concept of the
 * subject's tree or proposes a new concept under a parent. Here that answer is only validated —
 * the concept must belong to the subject, a new concept is deduped by conceptKey (upsert) — and
 * the old name match on topicPath is the fallback when the answer is missing or invalid.
 * Highlighted passages become `highlight` notes word for word.
 *
 * Loose notes (docs/NOTES.md §10.4): an item that matches no subject only creates a suggested
 * subject when there is study evidence — an assignment, an AI chat, or the same topic seen before
 * in an earlier loose encounter. Otherwise its encounter and notes stay unfiled (no subject).
 */
import type { Concept, Episode, PromptHabits, SourceRef, Subject } from '@shared/domain'
import type { ExtractedItem, ExtractOutput } from '../../brain-contract'
import type { MasteryModel, Repos } from '../../contracts'

export interface ApplyOutcome {
  encounterIds: string[]
  noteIds: string[]
  subjectIds: string[]
  newSubjectIds: string[]
  conceptIds: string[]
  assignmentIds: string[]
  profileChanged: boolean
  episodeSubjects: { episodeId: string; subjectId: string }[]
  learningEpisodes: number
}

/** Remembers which student prompts were already counted (bounded). */
export class PromptMemory {
  private readonly seen = new Set<string>()
  constructor(private readonly max = 500) {}

  /** True the first time a prompt is seen. */
  add(text: string): boolean {
    const key = text.toLowerCase().replace(/\s+/g, ' ').trim()
    if (!key || this.seen.has(key)) return false
    this.seen.add(key)
    if (this.seen.size > this.max) {
      const oldest = this.seen.values().next().value
      if (oldest !== undefined) this.seen.delete(oldest)
    }
    return true
  }
}

const NAME_NOISE = new Set([
  'i',
  'ii',
  'iii',
  'iv',
  '1',
  '2',
  '3',
  '4',
  'and',
  '&',
  'the',
  'of',
  'to',
  'intro',
  'introduction',
  'basics',
  'course',
  'a',
  'b',
])

function nameTokens(name: string): string[] {
  return name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}&\s]/gu, ' ')
    .split(/\s+/)
    .filter((t) => t && !NAME_NOISE.has(t))
    .map((t) => (t.length > 3 && t.endsWith('s') ? t.slice(0, -1) : t))
}

/** "Organic Chemistry I" ≈ "organic chemistry" (same tokens, ignoring numbering and fillers). */
export function sameSubjectName(a: string, b: string): boolean {
  const ta = [...new Set(nameTokens(a))].sort()
  const tb = [...new Set(nameTokens(b))].sort()
  return ta.length > 0 && ta.join(' ') === tb.join(' ')
}

/** Date-only answers become the end of that day in local time; unparseable → null. */
export function normalizeDue(due: string | null): string | null {
  if (!due) return null
  const s = due.trim()
  const dateOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dateOnly) {
    const [, y, m, d] = dateOnly
    return new Date(Number(y), Number(m) - 1, Number(d), 23, 59, 0).toISOString()
  }
  const t = Date.parse(s)
  return Number.isNaN(t) ? null : new Date(t).toISOString()
}

/** Is there study evidence for a subject the student hasn't got yet? (see the header) */
function studyEvidence(repos: Repos, item: ExtractedItem, episode: Episode, name: string): boolean {
  if (item.assignment?.title.trim()) return true
  if (episode.kind === 'ai_chat') return true
  return repos.encounters
    .list({ limit: 500 })
    .some(
      (e) =>
        e.subjectId === null &&
        e.episodeId !== episode.id &&
        e.topicPath.some((t) => sameSubjectName(t, name)),
    )
}

export function resolveSubject(
  repos: Repos,
  item: ExtractedItem,
  episode?: Episode,
): { subject: Subject | null; created: boolean } {
  const byId = item.subject.matchId ? repos.subjects.get(item.subject.matchId) : null
  if (byId) return { subject: byId, created: false }
  const name = item.subject.newName?.trim() || null
  const lookup = name ?? item.topicPath[0] ?? null
  if (lookup) {
    const exact = repos.subjects.findByName(lookup)
    if (exact) return { subject: exact, created: false }
    const fuzzy = repos.subjects.list().find((s) => sameSubjectName(s.name, lookup))
    if (fuzzy) return { subject: fuzzy, created: false }
  }
  if (!name) return { subject: null, created: false }
  if (episode && !studyEvidence(repos, item, episode, name))
    return { subject: null, created: false }
  const subject = repos.subjects.create({
    name: name.slice(0, 80),
    status: 'suggested',
    description: item.bigPicture.slice(0, 200),
  })
  return { subject, created: true }
}

export function applyExtraction(
  output: ExtractOutput,
  episodes: readonly Episode[],
  repos: Repos,
  opts: { mastery?: MasteryModel | null; prompts: PromptMemory; nowIso: string },
): ApplyOutcome {
  const outcome: ApplyOutcome = {
    encounterIds: [],
    noteIds: [],
    subjectIds: [],
    newSubjectIds: [],
    conceptIds: [],
    assignmentIds: [],
    profileChanged: false,
    episodeSubjects: [],
    learningEpisodes: 0,
  }
  const byId = new Map(episodes.map((e) => [e.id, e]))
  const habits: PromptHabits = { ...repos.profile.get().habits }
  const add = <T>(list: T[], value: T) => {
    if (!list.includes(value)) list.push(value)
  }

  for (const result of output.results) {
    const episode = byId.get(result.episodeId)
    if (!episode) continue
    for (const p of result.studentPrompts) {
      if (!opts.prompts.add(p.text)) continue
      habits.promptsSeen++
      if (p.hasContext) habits.withContext++
      if (p.hasStructure) habits.withStructure++
      if (p.asksToBeQuizzed) habits.askedToBeQuizzed++
      if (p.asksForExamples) habits.askedForExamples++
      outcome.profileChanged = true
    }
    if (!result.isLearning || result.items.length === 0) continue
    outcome.learningEpisodes++
    const source: SourceRef = {
      app: episode.app,
      bundleId: episode.bundleId,
      url: episode.url,
      title: episode.title,
    }
    let highlightsPlaced = false
    for (const item of result.items) {
      const { subject, created } = resolveSubject(repos, item, episode)
      if (subject) {
        add(outcome.subjectIds, subject.id)
        if (created) add(outcome.newSubjectIds, subject.id)
        outcome.episodeSubjects.push({ episodeId: episode.id, subjectId: subject.id })
      }
      const placed = (item.notes ?? []).map((note) => ({
        note,
        conceptId: subject ? placeNote(repos, subject, item, note) : null,
      }))
      // Name match on topicPath only as the fallback, built when something needs it.
      let chain: string | null | undefined
      const chainLeaf = () => {
        if (chain === undefined) chain = subject ? upsertChain(repos, subject, item) : null
        return chain
      }
      // The encounter sits where its first placed note went; else on the topicPath chain.
      const conceptId = subject ? (placed.find((p) => p.conceptId)?.conceptId ?? chainLeaf()) : null
      if (conceptId) add(outcome.conceptIds, conceptId)
      const encounter = repos.encounters.add({
        subjectId: subject?.id ?? null,
        conceptId,
        episodeId: episode.id,
        seen: item.seen,
        bigPicture: item.bigPicture,
        topicPath: item.topicPath,
        understanding: item.understanding.status,
        evidence: item.understanding.evidence,
        openQuestions: item.openQuestions.slice(0, 3),
        keyTerms: item.keyTerms.slice(0, 12),
        source,
        dwellSeconds: episode.dwellSeconds,
      })
      outcome.encounterIds.push(encounter.id)
      const addNote = (
        text: string,
        kind: 'fact' | 'highlight',
        noteConcept: string | null,
        keywords: string[],
      ) => {
        if (!text.trim()) return
        const { note, created: isNew } = repos.notes.add({
          subjectId: subject?.id ?? null,
          conceptId: noteConcept,
          encounterId: encounter.id,
          kind,
          text,
          keywords,
          source,
        })
        if (isNew) outcome.noteIds.push(note.id)
      }
      for (const p of placed.slice(0, 5))
        addNote(p.note.text, 'fact', subject ? (p.conceptId ?? chainLeaf()) : null, p.note.keywords)
      if (!highlightsPlaced) {
        highlightsPlaced = true
        for (const h of episode.signals.highlights ?? []) addNote(h, 'highlight', conceptId, [])
      }
      if (conceptId) {
        repos.concepts.update(conceptId, { lastSeenAt: episode.endedAt })
        opts.mastery?.applyEncounter(conceptId, item.understanding.status, opts.nowIso)
      }
      if (item.assignment?.title.trim()) {
        const assignment = repos.assignments.upsert({
          subjectId: subject?.id ?? null,
          title: item.assignment.title.trim(),
          course: item.assignment.course,
          dueAt: normalizeDue(item.assignment.dueAt),
          source: episode.url ?? episode.app,
        })
        add(outcome.assignmentIds, assignment.id)
      }
    }
  }
  outcome.episodeSubjects = [
    ...new Map(outcome.episodeSubjects.map((p) => [`${p.episodeId}|${p.subjectId}`, p])).values(),
  ]
  if (outcome.profileChanged) repos.profile.update({ habits })
  return outcome
}

/** A concept of `subject` by id, or null when the id is unknown or belongs elsewhere. */
function conceptIn(repos: Repos, subject: Subject, id: string | null): Concept | null {
  const concept = id ? repos.concepts.get(id) : null
  return concept && concept.subjectId === subject.id ? concept : null
}

/**
 * Validates the model's placement of one note: an existing concept of the subject, or a new
 * concept (deduped by conceptKey through upsert) under a valid parent (else top level). Returns
 * null when the model gave no usable placement; the caller falls back to the topicPath chain.
 */
function placeNote(
  repos: Repos,
  subject: Subject,
  item: ExtractedItem,
  note: NonNullable<ExtractedItem['notes']>[number],
): string | null {
  const existing = conceptIn(repos, subject, note.conceptId)
  if (existing) return existing.id
  const name = note.newConcept?.name.trim().slice(0, 80)
  if (!name || sameSubjectName(name, subject.name)) return null
  const parent = conceptIn(repos, subject, note.newConcept?.parentId ?? null)
  return repos.concepts.upsert({
    subjectId: subject.id,
    name,
    parentName: parent?.name ?? null,
    summary: item.seen.slice(0, 240),
  }).id
}

/** Upserts topicPath (minus the subject itself) as a parent → child chain; returns the leaf id. */
function upsertChain(repos: Repos, subject: Subject, item: ExtractedItem): string | null {
  const chain = item.topicPath
    .map((t) => t.trim().slice(0, 80))
    .filter((t) => t && !sameSubjectName(t, subject.name))
    .slice(-4)
  let parent: string | null = null
  let leafId: string | null = null
  for (const [i, name] of chain.entries()) {
    const concept = repos.concepts.upsert({
      subjectId: subject.id,
      name,
      parentName: parent,
      summary: i === chain.length - 1 ? item.seen.slice(0, 240) : undefined,
    })
    parent = concept.name
    leafId = concept.id
  }
  return leafId
}
