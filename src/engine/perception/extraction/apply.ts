/**
 * Applies extractor (P1) results to memory: matches or suggests a subject (no duplicates by
 * name), upserts the concept chain from topicPath, adds encounters with the three parts,
 * upserts assignments, counts prompt habits and lets the mastery model react. Pure Repos work,
 * run inside one transaction by the worker.
 */
import type { Episode, PromptHabits, Subject } from '@shared/domain'
import type { ExtractedItem, ExtractOutput } from '../../brain-contract'
import type { MasteryModel, Repos } from '../../contracts'

export interface ApplyOutcome {
  encounterIds: string[]
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

const NAME_NOISE = new Set(['i', 'ii', 'iii', 'iv', '1', '2', '3', '4', 'and', '&', 'the', 'of', 'to', 'intro', 'introduction', 'basics', 'course', 'a', 'b'])

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

export function resolveSubject(repos: Repos, item: ExtractedItem): { subject: Subject | null; created: boolean } {
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
    for (const item of result.items) {
      const { subject, created } = resolveSubject(repos, item)
      if (subject) {
        add(outcome.subjectIds, subject.id)
        if (created) add(outcome.newSubjectIds, subject.id)
        outcome.episodeSubjects.push({ episodeId: episode.id, subjectId: subject.id })
      }
      const conceptId = subject ? upsertChain(repos, subject, item) : null
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
        source: { app: episode.app, bundleId: episode.bundleId, url: episode.url, title: episode.title },
        dwellSeconds: episode.dwellSeconds,
      })
      outcome.encounterIds.push(encounter.id)
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
  outcome.episodeSubjects = [...new Map(outcome.episodeSubjects.map((p) => [`${p.episodeId}|${p.subjectId}`, p])).values()]
  if (outcome.profileChanged) repos.profile.update({ habits })
  return outcome
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
