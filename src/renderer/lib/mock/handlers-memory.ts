/**
 * Mock memory control (docs/NOTES.md §7): the subject's topic tree with notes, loose notes,
 * editing (pins the note) and deleting notes, concepts and encounters, filing loose notes.
 * Mirrors engine/subjects/memory-control.ts on the mock database.
 */
import type { Concept, Note } from '@shared/domain'
import type { SubjectTree } from '@shared/state'
import type { HandlerMap, MockContext } from './context'
import { nowIso } from './time'

export type MemoryChannel =
  | 'subjects.tree'
  | 'notes.loose'
  | 'notes.update'
  | 'notes.delete'
  | 'notes.file'
  | 'concepts.update'
  | 'concepts.delete'
  | 'concepts.openText'
  | 'encounters.delete'

/** Each parent before its children, siblings by name (as memory-control.treeOrder). */
function treeOrder(concepts: Concept[]): Concept[] {
  const ids = new Set(concepts.map((c) => c.id))
  const kids = (parent: string | null) =>
    concepts
      .filter((c) => (c.parentId && ids.has(c.parentId) ? c.parentId : null) === parent)
      .sort((a, b) => a.name.localeCompare(b.name))
  const out: Concept[] = []
  const walk = (parent: string | null) => {
    for (const c of kids(parent)) {
      if (out.includes(c)) continue
      out.push(c)
      walk(c.id)
    }
  }
  walk(null)
  for (const c of concepts) if (!out.includes(c)) out.push(c)
  return out
}

const active = (ctx: MockContext) => ctx.db.notes.filter((n) => n.status === 'active')

function mustNote(ctx: MockContext, id: string): Note {
  const note = ctx.db.notes.find((n) => n.id === id && n.status === 'active')
  if (!note) throw new Error('That note no longer exists.')
  return note
}

function mustConcept(ctx: MockContext, id: string): Concept {
  const concept = ctx.db.concepts.find((c) => c.id === id)
  if (!concept) throw new Error('That topic no longer exists.')
  return concept
}

const announce = (ctx: MockContext, subjectId: string | null) =>
  subjectId ? ctx.changed('subjects', [subjectId]) : ctx.changed('inbox')

export const memoryHandlers: HandlerMap<MemoryChannel> = {
  'subjects.tree': (ctx, subjectId) => {
    if (!ctx.db.subjects.some((s) => s.id === subjectId))
      throw new Error('That subject no longer exists.')
    const concepts = treeOrder(ctx.db.concepts.filter((c) => c.subjectId === subjectId))
    const known = new Set(concepts.map((c) => c.id))
    const notes = active(ctx).filter((n) => n.subjectId === subjectId)
    const tree: SubjectTree = {
      subjectId,
      concepts: concepts.map((concept) => ({
        concept: structuredClone(concept),
        notes: structuredClone(notes.filter((n) => n.conceptId === concept.id)),
      })),
      unplaced: structuredClone(notes.filter((n) => !n.conceptId || !known.has(n.conceptId))),
      edges: structuredClone(ctx.db.edges.filter((e) => known.has(e.fromId))),
    }
    return tree
  },

  'notes.loose': (ctx) =>
    structuredClone(active(ctx).filter((n) => n.subjectId === null)).reverse(),

  'notes.update': (ctx, { id, text }) => {
    const note = mustNote(ctx, id)
    const clean = text.trim()
    if (!clean) throw new Error('A note needs text')
    Object.assign(note, { text: clean.slice(0, 200), pinned: true, updatedAt: nowIso() })
    announce(ctx, note.subjectId)
    return structuredClone(note)
  },

  'notes.delete': (ctx, id) => {
    const note = mustNote(ctx, id)
    Object.assign(note, { status: 'deleted', updatedAt: nowIso() })
    announce(ctx, note.subjectId)
  },

  'notes.file': (ctx, { id, subjectId, conceptId }) => {
    const note = mustNote(ctx, id)
    if (!ctx.db.subjects.some((s) => s.id === subjectId))
      throw new Error('That subject no longer exists.')
    if (conceptId && mustConcept(ctx, conceptId).subjectId !== subjectId)
      throw new Error('That topic belongs to another subject')
    Object.assign(note, { subjectId, conceptId, updatedAt: nowIso() })
    ctx.changed('subjects', [subjectId])
    ctx.changed('inbox')
    return structuredClone(note)
  },

  'concepts.update': (ctx, { id, name, summary }) => {
    const concept = mustConcept(ctx, id)
    if (name !== undefined) {
      const clean = name.trim()
      const twin = ctx.db.concepts.find(
        (c) =>
          c.subjectId === concept.subjectId &&
          c.id !== id &&
          c.name.toLowerCase() === clean.toLowerCase(),
      )
      if (twin) throw new Error(`"${twin.name}" already exists in this subject`)
      concept.name = clean
    }
    if (summary !== undefined) concept.summary = summary.trim()
    ctx.changed('concepts', [id])
    return structuredClone(concept)
  },

  'concepts.delete': (ctx, id) => {
    const concept = mustConcept(ctx, id)
    const { db } = ctx
    for (const n of db.notes) {
      if (n.conceptId !== id) continue
      if (n.status === 'active') Object.assign(n, { status: 'deleted', updatedAt: nowIso() })
      n.conceptId = null
    }
    for (const c of db.concepts) if (c.parentId === id) c.parentId = concept.parentId
    for (const e of db.encounters) if (e.conceptId === id) e.conceptId = null
    db.edges = db.edges.filter((e) => e.fromId !== id && e.toId !== id)
    db.concepts = db.concepts.filter((c) => c.id !== id)
    ctx.changed('subjects', [concept.subjectId])
  },

  /** The browser preview has no files: it only says where the app would write the text. */
  'concepts.openText': (ctx, id) => {
    const concept = mustConcept(ctx, id)
    return { path: `~/Library/Application Support/Dumbledore/exports/topics/${concept.id}.txt` }
  },

  'encounters.delete': (ctx, id) => {
    const { db } = ctx
    const encounter = db.encounters.find((e) => e.id === id)
    if (!encounter) throw new Error('That item no longer exists.')
    for (const n of db.notes)
      if (n.encounterId === id && n.status === 'active')
        Object.assign(n, { status: 'deleted', updatedAt: nowIso() })
    db.encounters = db.encounters.filter((e) => e.id !== id)
    announce(ctx, encounter.subjectId)
    ctx.changed('inbox', [id])
  },
}
