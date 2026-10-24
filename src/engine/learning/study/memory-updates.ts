/**
 * The step writer's `memory_updates` channel (PLAN R37/R39): what the chat showed about the
 * student becomes encounters (one per concept and step) and concept updates via MasteryModel.
 * Their text reads like perception's (memory-text.ts): no echoed context labels, no log lines.
 */
import {
  type Id,
  type LearnItem,
  type Roadmap,
  type Subject,
  UnderstandingStatus,
} from '@shared/domain'
import type { MemoryUpdate } from '../../brain-contract'
import type { MasteryModel, Repos } from '../../contracts'
import type { StudyDeps } from './deps'
import { bigPictureText, evidenceText, seenText, topicPathOf } from './memory-text'
import { isLearn } from './roadmap-ops'
import { norm } from './text'

export type MemoryDeps = Pick<StudyDeps, 'repos' | 'mastery' | 'clock' | 'bus'>

export interface MemoryUpdateScope {
  repos: Repos
  mastery: MasteryModel
  subject: Subject
  roadmap: Roadmap
  stepTitle: string
  assistant: string
  nowIso: string
}

export interface AppliedUpdates {
  conceptIds: Id[]
  encounterIds: Id[]
}

interface Group {
  concept: string
  notes: string[]
  evidence: string[]
  questions: string[]
  understanding: UnderstandingStatus | null
}

function group(updates: MemoryUpdate[]): Group[] {
  const groups = new Map<string, Group>()
  for (const u of updates) {
    const concept = u.concept.trim()
    const value = u.value.trim()
    if (!concept) continue
    const key = norm(concept)
    const g = groups.get(key) ?? {
      concept,
      notes: [],
      evidence: [],
      questions: [],
      understanding: null,
    }
    if (u.evidence.trim()) g.evidence.push(u.evidence.trim())
    if (u.type === 'note' && value) g.notes.push(value)
    if (u.type === 'question' && value) g.questions.push(value)
    if (u.type === 'understanding') {
      const parsed = UnderstandingStatus.safeParse(value.toLowerCase())
      g.understanding = parsed.success ? parsed.data : 'unknown'
    }
    groups.set(key, g)
  }
  return [...groups.values()]
}

export function applyMemoryUpdates(
  scope: MemoryUpdateScope,
  updates: MemoryUpdate[],
): AppliedUpdates {
  const applied: AppliedUpdates = { conceptIds: [], encounterIds: [] }
  const { repos, subject, roadmap } = scope
  for (const g of group(updates)) {
    try {
      const concept = repos.concepts.upsert({ subjectId: subject.id, name: g.concept })
      const topicPath = topicPathOf([subject.name, concept.name])
      const encounter = repos.encounters.add({
        subjectId: subject.id,
        conceptId: concept.id,
        episodeId: null,
        seen: seenText(g.notes, concept.name, scope.stepTitle, scope.assistant),
        bigPicture: bigPictureText(topicPathOf([subject.name, roadmap.title, concept.name])),
        topicPath,
        understanding: g.understanding ?? 'unknown',
        evidence: evidenceText(g.evidence, concept.name, g.understanding),
        openQuestions: g.questions.slice(0, 3),
        keyTerms: [concept.name],
        source: { app: scope.assistant, bundleId: null, url: null, title: roadmap.title },
        dwellSeconds: 0,
        inboxState: 'accepted',
      })
      if (g.understanding) scope.mastery.applyEncounter(concept.id, g.understanding, scope.nowIso)
      applied.conceptIds.push(concept.id)
      applied.encounterIds.push(encounter.id)
    } catch (error) {
      console.warn('[study] memory update failed', g.concept, error)
    }
  }
  return applied
}

/**
 * Applies the step writer's memory updates for the chat that led up to `item` and announces the
 * changes. The chat excerpt mostly shows the previous step's answer, so that step names the record.
 */
export function rememberStep(
  deps: MemoryDeps,
  roadmap: Roadmap,
  item: LearnItem,
  assistant: string,
  updates: MemoryUpdate[],
): void {
  if (updates.length === 0) return
  const subject = deps.repos.subjects.get(roadmap.subjectId)
  if (!subject) return
  const previous = roadmap.items
    .filter((i) => isLearn(i) && i.idx < item.idx && i.status === 'done')
    .at(-1)
  const applied = applyMemoryUpdates(
    {
      repos: deps.repos,
      mastery: deps.mastery,
      subject,
      roadmap,
      stepTitle: previous?.title ?? item.title,
      assistant,
      nowIso: deps.clock.nowIso(),
    },
    updates,
  )
  if (applied.conceptIds.length > 0) {
    deps.bus.emit('memory:changed', { scope: 'concepts', ids: applied.conceptIds })
  }
  if (applied.encounterIds.length > 0) {
    deps.bus.emit('memory:changed', { scope: 'inbox', ids: applied.encounterIds })
  }
}

/** A finished learn step counts as reading about its concepts (small mastery effect, lastSeenAt). */
export function touchConcepts(deps: MemoryDeps, subjectId: Id, names: string[]): void {
  const ids: Id[] = []
  for (const name of names) {
    try {
      const concept = deps.repos.concepts.upsert({ subjectId, name })
      deps.mastery.applyEncounter(concept.id, 'unknown', deps.clock.nowIso())
      ids.push(concept.id)
    } catch (error) {
      console.warn('[study] could not update concept', name, error)
    }
  }
  if (ids.length > 0) deps.bus.emit('memory:changed', { scope: 'concepts', ids })
}
