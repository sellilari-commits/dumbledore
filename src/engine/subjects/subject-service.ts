/**
 * SubjectService: the subject, inbox and assignment commands behind the app (contracts.ts).
 * Every change is announced as 'memory:changed' on the engine bus, which also drives the
 * MemoryMirror and the renderer's query invalidation.
 *
 * Moving an encounter's concept to another subject needs two writes the Repos contract lacks;
 * they come from `relink` (SqliteRepos provides it). Without it, assign still moves the encounter
 * and makes sure the target subject has the concept, but the encounter keeps its old concept id.
 */
import type { Concept, Encounter, Id, Subject } from '@shared/domain'
import type { MemoryScope, SubjectPatch } from '@shared/state'
import type { Repos, SubjectService } from '../contracts'
import type { EngineBus } from '../events'
import type { RelinkSupport } from '../store/sqlite-repos'
import { pickSubjectEmoji } from './emoji'
import { createMemoryControl } from './memory-control'

export interface SubjectServiceDeps {
  repos: Repos
  bus: EngineBus
  /** Defaults to `repos.relink` when the repos provide it (SqliteRepos does). */
  relink?: RelinkSupport | null
}

function relinkOf(repos: Repos): RelinkSupport | null {
  const candidate = (repos as Repos & { relink?: RelinkSupport }).relink
  return candidate && typeof candidate.moveConcept === 'function' ? candidate : null
}

const clean = (s: string | null | undefined): string | null => {
  const t = s?.trim()
  return t ? t : null
}

export function createSubjectService(deps: SubjectServiceDeps): SubjectService {
  const { repos, bus } = deps
  const relink = deps.relink === undefined ? relinkOf(repos) : deps.relink
  const emit = (scope: MemoryScope, ids: Id[]) => bus.emit('memory:changed', { scope, ids })

  const mustSubject = (id: Id): Subject => {
    const s = repos.subjects.get(id)
    if (!s) throw new Error(`subject ${id} not found`)
    return s
  }

  const assertNameFree = (name: string, selfId: Id | null) => {
    const twin = repos.subjects.findByName(name)
    if (twin && twin.id !== selfId)
      throw new Error(`A subject called "${twin.name}" already exists`)
  }

  /** Gives encounter `e` (already moved to `targetId`) a concept that lives in the target subject. */
  const moveConcept = (e: Encounter, targetId: Id): void => {
    const concept = e.conceptId ? repos.concepts.get(e.conceptId) : null
    if (!concept || concept.subjectId === targetId) return
    const twin = repos.concepts.findByName(targetId, concept.name)
    if (!relink) {
      if (!twin)
        repos.concepts.upsert({ subjectId: targetId, name: concept.name, summary: concept.summary })
      return
    }
    if (twin) {
      relink.setEncounterConcept(e.id, twin.id)
      return
    }
    const sharedWithOthers = repos.encounters
      .list({ subjectId: concept.subjectId })
      .some((x) => x.id !== e.id && x.conceptId === concept.id)
    if (!sharedWithOthers) {
      relink.moveConcept(concept.id, targetId)
      return
    }
    const parent = concept.parentId ? repos.concepts.get(concept.parentId) : null
    const copy: Concept = repos.concepts.upsert({
      subjectId: targetId,
      name: concept.name,
      parentName: parent?.name ?? null,
      summary: concept.summary,
    })
    relink.setEncounterConcept(e.id, copy.id)
  }

  /** Moves an encounter (accepted) to another subject, taking its concept and notes along. */
  const assign = (encounterId: Id, subjectId: Id): void => {
    const moved = repos.encounters.setInboxState(encounterId, 'accepted', subjectId)
    moveConcept(moved, subjectId)
    fileNotes(encounterId, subjectId)
  }

  /**
   * Files an encounter's notes (loose ones included) under the subject, on the encounter's
   * concept when it now lives there; otherwise unplaced in the subject, for consolidation.
   */
  const fileNotes = (encounterId: Id, subjectId: Id): void => {
    const encounter = repos.encounters.list({ subjectId }).find((e) => e.id === encounterId)
    const concept = encounter?.conceptId ? repos.concepts.get(encounter.conceptId) : null
    const conceptId = concept?.subjectId === subjectId ? concept.id : null
    for (const note of repos.notes.list({ encounterId })) {
      const own = note.conceptId ? repos.concepts.get(note.conceptId) : null
      if (note.subjectId === subjectId && own?.subjectId === subjectId) continue
      repos.notes.update(note.id, {
        subjectId,
        conceptId: own?.subjectId === subjectId ? own.id : conceptId,
      })
    }
  }

  return {
    // Memory control (tree, notes, deletes); the IPC handlers announce the changes.
    ...createMemoryControl(repos),

    create(input) {
      const name = clean(input.name)
      if (!name) throw new Error('A subject needs a name')
      const existing = repos.subjects.findByName(name)
      const emoji = clean(input.emoji)
      const goal = clean(input.goal)
      let subject: Subject
      if (existing) {
        // Creating a subject that exists (e.g. a suggested one) re-activates it instead.
        subject = repos.subjects.update(existing.id, {
          status: 'active',
          ...(emoji ? { emoji } : {}),
          ...(goal ? { goal } : {}),
          ...(input.deadline ? { deadline: input.deadline } : {}),
        })
      } else {
        subject = repos.subjects.create({
          name,
          emoji: emoji ?? pickSubjectEmoji(name),
          goal,
          deadline: input.deadline ?? null,
        })
      }
      emit('subjects', [subject.id])
      return subject
    },

    update(id, patch) {
      const current = mustSubject(id)
      const next: SubjectPatch = { ...patch }
      if (patch.name !== undefined) {
        const name = clean(patch.name)
        if (!name) throw new Error('A subject needs a name')
        assertNameFree(name, id)
        next.name = name
      }
      if (patch.emoji !== undefined)
        next.emoji = clean(patch.emoji) ?? pickSubjectEmoji(next.name ?? current.name)
      if (patch.goal !== undefined) next.goal = clean(patch.goal)
      const subject = repos.subjects.update(id, next)
      emit('subjects', [id])
      return subject
    },

    remove(id) {
      mustSubject(id)
      repos.transaction(() => {
        repos.subjects.remove(id)
        if (repos.settings.get().focusSubjectId === id)
          repos.settings.update({ focusSubjectId: null })
      })
      emit('subjects', [id])
      emit('inbox', [])
    },

    actSuggested(subjectId, action, intoId) {
      mustSubject(subjectId)
      if (action === 'merge') {
        if (!intoId) throw new Error('Pick the subject to merge into')
        if (intoId === subjectId) throw new Error('A subject cannot be merged into itself')
        mustSubject(intoId)
        repos.transaction(() => repos.subjects.merge(subjectId, intoId))
        emit('subjects', [subjectId, intoId])
        emit('inbox', [])
        return
      }
      repos.subjects.update(subjectId, { status: action === 'accept' ? 'active' : 'archived' })
      emit('subjects', [subjectId])
    },

    actInbox(encounterId, action, subjectId) {
      if (action === 'ignore') {
        repos.transaction(() => {
          repos.encounters.setInboxState(encounterId, 'ignored')
          // Ignored means "not mine to remember": its notes go too.
          for (const note of repos.notes.list({ encounterId })) repos.notes.remove(note.id)
        })
        emit('inbox', [encounterId])
        return
      }
      if (action === 'assign' && !subjectId) throw new Error('Pick a subject to assign this to')
      if (subjectId) mustSubject(subjectId)
      const from = repos.transaction(() => {
        const before = repos.encounters.setInboxState(encounterId, 'accepted')
        if (subjectId && subjectId !== before.subjectId) assign(encounterId, subjectId)
        return before.subjectId
      })
      emit('inbox', [encounterId])
      if (subjectId && subjectId !== from) {
        emit(
          'subjects',
          [from, subjectId].filter((x): x is Id => x !== null),
        )
      }
    },

    addAssignment(input) {
      const title = clean(input.title)
      if (!title) throw new Error('An assignment needs a title')
      if (input.subjectId) mustSubject(input.subjectId)
      const assignment = repos.assignments.upsert({
        subjectId: input.subjectId,
        title,
        course: null,
        dueAt: input.dueAt,
        source: 'manual',
      })
      emit('assignments', [assignment.id])
      return assignment
    },
  }
}
