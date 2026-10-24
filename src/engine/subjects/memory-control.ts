/**
 * Memory control (docs/NOTES.md §7): what the student sees of a subject's memory and the edits
 * they can make to it. Reads: the topic tree with its notes and edges, and the loose notes. Writes:
 * edit a note (it becomes pinned, so consolidation never rewrites it), delete a note, file a loose
 * note into a subject, rename a concept or change its summary, delete a concept or an encounter.
 *
 * Plain repo work with no bus: the callers (SubjectService, the IPC handlers) announce
 * 'memory:changed', which refreshes the memory file, search and the windows.
 */
import type { Concept, Id, Note } from '@shared/domain'
import type { ConceptNode, SubjectTree } from '@shared/state'
import type { MemoryControl, Repos } from '../contracts'
import { sourcesOfNotes, subtreeIds } from '../memory/sources'

/** Each parent before its children, siblings by name; orphans (missing parent) at the top. */
export function treeOrder(concepts: readonly Concept[]): Concept[] {
  const ids = new Set(concepts.map((c) => c.id))
  const children = new Map<Id | null, Concept[]>()
  for (const c of concepts) {
    const parent = c.parentId && ids.has(c.parentId) ? c.parentId : null
    const list = children.get(parent) ?? []
    list.push(c)
    children.set(parent, list)
  }
  for (const list of children.values()) list.sort((a, b) => a.name.localeCompare(b.name))
  const out: Concept[] = []
  const seen = new Set<Id>()
  const walk = (parent: Id | null) => {
    for (const c of children.get(parent) ?? []) {
      if (seen.has(c.id)) continue
      seen.add(c.id)
      out.push(c)
      walk(c.id)
    }
  }
  walk(null)
  // A parent cycle never reaches the root: keep those concepts anyway.
  for (const c of concepts) if (!seen.has(c.id)) out.push(c)
  return out
}

export function createMemoryControl(repos: Repos): MemoryControl {
  const mustSubject = (id: Id) => {
    const s = repos.subjects.get(id)
    if (!s) throw new Error(`subject ${id} not found`)
    return s
  }
  const mustNote = (id: Id): Note => {
    const n = repos.notes.get(id)
    if (n?.status !== 'active') throw new Error(`note ${id} not found`)
    return n
  }
  const mustConcept = (id: Id): Concept => {
    const c = repos.concepts.get(id)
    if (!c) throw new Error(`concept ${id} not found`)
    return c
  }

  return {
    tree(subjectId) {
      mustSubject(subjectId)
      const concepts = treeOrder(repos.concepts.listBySubject(subjectId))
      const byConcept = new Map<Id, Note[]>()
      const unplaced: Note[] = []
      const known = new Set(concepts.map((c) => c.id))
      for (const note of repos.notes.list({ subjectId })) {
        if (note.conceptId && known.has(note.conceptId)) {
          const list = byConcept.get(note.conceptId) ?? []
          list.push(note)
          byConcept.set(note.conceptId, list)
        } else unplaced.push(note)
      }
      const nodes: ConceptNode[] = concepts.map((concept) => {
        const ids = subtreeIds(concept.id, concepts)
        return {
          concept,
          notes: byConcept.get(concept.id) ?? [],
          sources: sourcesOfNotes([...ids].flatMap((id) => byConcept.get(id) ?? [])),
        }
      })
      const tree: SubjectTree = {
        subjectId,
        concepts: nodes,
        unplaced,
        edges: repos.edges.list(subjectId),
      }
      return tree
    },

    looseNotes() {
      return repos.notes.list({ subjectId: null }).reverse()
    },

    updateNote(id, text) {
      mustNote(id)
      const clean = text.trim()
      if (!clean) throw new Error('A note needs text')
      return repos.notes.update(id, { text: clean, pinned: true })
    },

    deleteNote(id) {
      const note = mustNote(id)
      repos.notes.remove(id)
      return note
    },

    fileNote(id, subjectId, conceptId) {
      mustNote(id)
      mustSubject(subjectId)
      if (conceptId && mustConcept(conceptId).subjectId !== subjectId)
        throw new Error('That topic belongs to another subject')
      return repos.notes.update(id, { subjectId, conceptId })
    },

    updateConcept(id, patch) {
      const concept = mustConcept(id)
      const next: { name?: string; summary?: string; summaryPinned?: boolean } = {}
      if (patch.name !== undefined) {
        const name = patch.name.trim()
        if (!name) throw new Error('A topic needs a name')
        const twin = repos.concepts.findByName(concept.subjectId, name)
        if (twin && twin.id !== id) throw new Error(`"${twin.name}" already exists in this subject`)
        next.name = name
      }
      if (patch.summary !== undefined) {
        next.summary = patch.summary.trim()
        // The student's own summary: consolidation never rewrites it (docs/NOTES.md §7).
        next.summaryPinned = true
      }
      return Object.keys(next).length > 0 ? repos.concepts.update(id, next) : concept
    },

    deleteConcept(id) {
      const concept = mustConcept(id)
      repos.transaction(() => repos.concepts.remove(id))
      return concept
    },

    deleteEncounter(id) {
      // EncounterRepo has no get; the newest few thousand cover every encounter the UI shows.
      const encounter = repos.encounters.list({}).find((e) => e.id === id)
      if (!encounter) throw new Error(`encounter ${id} not found`)
      repos.transaction(() => repos.encounters.remove(id))
      return encounter
    },
  }
}
