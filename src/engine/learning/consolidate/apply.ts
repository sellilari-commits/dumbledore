/**
 * Applies a consolidation answer (P13) to one subject's memory — but only what survives
 * validation (docs/NOTES.md §5):
 * - every id must exist in this subject (concepts) or be an active note of it;
 * - pinned notes (edited by the student) are never merged, reworded or moved;
 * - nothing is invented without evidence: a summary only for a concept with notes, a topic only
 *   when one of its children has notes;
 * - the tree never gets a loop (a concept under its own descendant), edges never a cycle (the
 *   EdgeRepo refuses those), and the top level keeps at most MAX_TOPICS topics.
 * - a concept moves to another subject only when that subject exists and is active; it takes its
 *   notes along (its edges go, they never cross subjects).
 * Concept merges and moves need `relink` (SQLite); without it they are skipped.
 * Callers run this inside one transaction.
 */
import type { Concept, Note } from '@shared/domain'
import type { ConsolidateOutput } from '../../brain-contract'
import type { Repos } from '../../contracts'
import type { RelinkSupport } from '../../store/sqlite-repos'

export const MAX_TOPICS = 9
const MAX_SUMMARY_CHARS = 400
const OTHER_TOPIC = 'Other topics'
const QUESTION_SOURCE = { app: 'Dumbledore', bundleId: null, url: null, title: 'Your notes' }

export interface ConsolidationReport {
  summaries: number
  mergedConcepts: number
  mergedNotes: number
  placedNotes: number
  reparented: number
  newTopics: number
  edges: number
  questions: number
  movedConcepts: number
  /** Subjects that received a moved concept. */
  movedTo: string[]
  /** What was refused, for the log ("mergeNotes not_1: pinned"). */
  skipped: string[]
}

export function applyConsolidation(
  repos: Repos,
  subjectId: string,
  out: ConsolidateOutput,
  opts: { relink?: RelinkSupport | null } = {},
): ConsolidationReport {
  const report: ConsolidationReport = {
    summaries: 0,
    mergedConcepts: 0,
    mergedNotes: 0,
    placedNotes: 0,
    reparented: 0,
    newTopics: 0,
    edges: 0,
    questions: 0,
    movedConcepts: 0,
    movedTo: [],
    skipped: [],
  }
  const skip = (what: string) => report.skipped.push(what)
  const concepts = () => new Map(repos.concepts.listBySubject(subjectId).map((c) => [c.id, c]))
  const activeNote = (id: string): Note | null => {
    const n = repos.notes.get(id)
    return n && n.status === 'active' && n.subjectId === subjectId ? n : null
  }

  // 1. Duplicate notes.
  for (const m of out.mergeNotes) {
    const from = activeNote(m.fromId)
    const into = activeNote(m.intoId)
    if (!from || !into || from.id === into.id) skip(`mergeNotes ${m.fromId}: unknown`)
    else if (from.pinned || into.pinned) skip(`mergeNotes ${m.fromId}: pinned`)
    else {
      repos.notes.merge(from.id, into.id, m.text ?? undefined)
      report.mergedNotes++
    }
  }

  // 2. Duplicate concepts (folded: notes, encounters, edges and children move to the survivor).
  const mergedInto = new Map<string, string>()
  const resolve = (id: string): string => {
    let x = id
    for (let i = 0; i < 20 && mergedInto.has(x); i++) x = mergedInto.get(x) as string
    return x
  }
  for (const m of out.mergeConcepts) {
    const all = concepts()
    const from = all.get(resolve(m.fromId))
    const into = all.get(resolve(m.intoId))
    if (!from || !into || from.id === into.id) skip(`mergeConcepts ${m.fromId}: unknown`)
    else if (!opts.relink) skip(`mergeConcepts ${m.fromId}: no relink`)
    else {
      opts.relink.mergeConcepts(from.id, into.id)
      mergedInto.set(from.id, into.id)
      report.mergedConcepts++
    }
  }

  // 3. Notes to their concept.
  for (const p of out.placeNotes) {
    const note = activeNote(p.noteId)
    const target = concepts().get(resolve(p.conceptId))
    if (!note || !target) skip(`placeNotes ${p.noteId}: unknown`)
    else if (note.pinned) skip(`placeNotes ${p.noteId}: pinned`)
    else if (note.conceptId !== target.id) {
      repos.notes.update(note.id, { conceptId: target.id })
      report.placedNotes++
    }
  }

  // 3b. Concepts that belong to another of the student's subjects.
  for (const m of out.moveConcepts ?? []) {
    const concept = concepts().get(resolve(m.conceptId))
    const target = repos.subjects.get(m.subjectId)
    if (!concept || !target || target.id === subjectId || target.status !== 'active')
      skip(`moveConcepts ${m.conceptId}: unknown`)
    else if (!opts.relink) skip(`moveConcepts ${m.conceptId}: no relink`)
    else {
      opts.relink.moveConcept(concept.id, target.id)
      report.movedConcepts++
      if (!report.movedTo.includes(target.id)) report.movedTo.push(target.id)
    }
  }

  // Evidence: active notes per concept, and per subtree.
  const noteCount = new Map<string, number>()
  for (const n of repos.notes.list({ subjectId }))
    if (n.conceptId) noteCount.set(n.conceptId, (noteCount.get(n.conceptId) ?? 0) + 1)
  const subtreeNotes = (id: string, all: Map<string, Concept>): number => {
    let total = 0
    const stack = [id]
    const seen = new Set<string>()
    while (stack.length) {
      const x = stack.pop() as string
      if (seen.has(x)) continue
      seen.add(x)
      total += noteCount.get(x) ?? 0
      for (const c of all.values()) if (c.parentId === x) stack.push(c.id)
    }
    return total
  }

  // 4. Summaries, written from notes only.
  for (const s of out.summaries) {
    const all = concepts()
    const c = all.get(resolve(s.conceptId))
    const text = s.summary.replace(/\s+/g, ' ').trim().slice(0, MAX_SUMMARY_CHARS)
    if (!c || !text) skip(`summary ${s.conceptId}: unknown`)
    else if (c.summaryPinned) skip(`summary ${c.id}: pinned`)
    else if (subtreeNotes(c.id, all) === 0) skip(`summary ${c.id}: no notes`)
    else if (c.summary !== text) {
      repos.concepts.update(c.id, { summary: text })
      report.summaries++
    }
  }

  // 5. The top level: at most MAX_TOPICS topics, each with evidence among its children.
  const isUnder = (id: string, ancestor: string, all: Map<string, Concept>): boolean => {
    let x = all.get(id)?.parentId ?? null
    for (let i = 0; x && i < 50; i++) {
      if (x === ancestor) return true
      x = all.get(x)?.parentId ?? null
    }
    return false
  }
  const proposals = out.topics
    .map((t) => {
      const all = concepts()
      const children = [...new Set(t.children.map(resolve))].filter((id) => all.has(id))
      const support = children.reduce((n, id) => n + subtreeNotes(id, all), 0)
      return { topic: t, children, support }
    })
    .filter((p) => {
      if (p.support > 0 && (p.topic.conceptId || p.topic.name)) return true
      skip(`topic ${p.topic.name || p.topic.conceptId}: no notes`)
      return false
    })
    .sort((a, b) => b.support - a.support)
  for (const extra of proposals.slice(MAX_TOPICS))
    skip(`topic ${extra.topic.name}: over ${MAX_TOPICS}`)
  const topicIds: string[] = []
  for (const { topic, children } of proposals.slice(0, MAX_TOPICS)) {
    let all = concepts()
    let topicId = topic.conceptId ? resolve(topic.conceptId) : null
    if (topicId && !all.has(topicId)) topicId = null
    if (!topicId) {
      const name = topic.name.trim().slice(0, 80)
      if (!name) {
        skip('topic: no name')
        continue
      }
      const before = all.size
      topicId = repos.concepts.upsert({ subjectId, name }).id
      all = concepts()
      if (all.size > before) report.newTopics++
    }
    const t = all.get(topicId) as Concept
    if (t.parentId !== null) {
      repos.concepts.update(topicId, { parentId: null })
      report.reparented++
    }
    topicIds.push(topicId)
    for (const childId of children) {
      all = concepts()
      const child = all.get(childId)
      if (!child || child.id === topicId) continue
      if (isUnder(topicId, childId, all)) {
        skip(`reparent ${childId}: loop`)
        continue
      }
      if (child.parentId !== topicId) {
        repos.concepts.update(childId, { parentId: topicId })
        report.reparented++
      }
    }
  }
  // At most MAX_TOPICS at the top: past that, the topics with the least evidence and any older
  // top-level concepts share one "Other topics" topic (which counts as one of them).
  if (topicIds.length > 0) {
    const all = concepts()
    const existingOther = repos.concepts.findByName(subjectId, OTHER_TOPIC)
    const roots = [...all.values()].filter((c) => c.parentId === null && c.id !== existingOther?.id)
    if (roots.length + (existingOther ? 1 : 0) > MAX_TOPICS) {
      const ranked = roots.sort(
        (a, b) =>
          Number(topicIds.includes(b.id)) - Number(topicIds.includes(a.id)) ||
          subtreeNotes(b.id, all) - subtreeNotes(a.id, all),
      )
      const extra = ranked.slice(MAX_TOPICS - 1)
      if (extra.some((c) => subtreeNotes(c.id, all) > 0)) {
        const other = existingOther ?? repos.concepts.upsert({ subjectId, name: OTHER_TOPIC })
        if (!existingOther) report.newTopics++
        for (const c of extra) {
          repos.concepts.update(c.id, { parentId: other.id })
          report.reparented++
        }
      }
    }
  }

  // 6. Prerequisite edges (the EdgeRepo refuses loops, duplicates and other subjects).
  for (const e of out.edges) {
    const all = concepts()
    const from = all.get(resolve(e.fromId))
    const to = all.get(resolve(e.toId))
    if (!from || !to) skip(`edge ${e.fromId}→${e.toId}: unknown`)
    else if (repos.edges.add({ fromId: from.id, toId: to.id, why: e.why, source: 'llm' }))
      report.edges++
    else skip(`edge ${from.id}→${to.id}: refused`)
  }

  // 7. Open questions become question notes (deduped like every note).
  for (const q of out.openQuestions) {
    const target = q.conceptId ? concepts().get(resolve(q.conceptId)) : undefined
    const { created } = repos.notes.add({
      subjectId,
      conceptId: target?.id ?? null,
      encounterId: null,
      kind: 'question',
      text: q.question,
      source: QUESTION_SOURCE,
    })
    if (created) report.questions++
  }
  return report
}
