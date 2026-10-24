/**
 * Typed notes: a note the coach proposes (add_note, run as a chip or toast button outside the
 * double-tap chat, which takes no notes) and its undo. A typed note is the student's own words:
 * pinned, so consolidation never rewrites it.
 *
 * Placement: a concept the coach named (it must exist), else a subject it named (on the current
 * topic when that topic belongs to it, else on the subject itself), else the current topic (the
 * locked one, else the newest; the panel and right-⌥ agree via shared/topics.ts), else a loose
 * note.
 */
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { Id, Note } from '@shared/domain'
import { currentTopic, listTopics, type Topic } from '@shared/topics'

export const TYPED_SOURCE: Note['source'] = {
  app: 'Dumbledore',
  bundleId: null,
  url: null,
  title: 'Typed in chat',
}

export interface TypedNoteInput {
  text: string
  subjectId: Id | null
  conceptId: Id | null
}

export interface SavedNote {
  noteId: Id
  /** Where it went, for the reply: a topic, a subject or "Loose notes". */
  where: string
}

export interface TypedNotesDeps {
  repos: Pick<Repos, 'notes' | 'subjects' | 'concepts' | 'settings'>
  bus: EngineBus
}

export class TypedNotes {
  constructor(private readonly deps: TypedNotesDeps) {}

  /** Topics in the order the panel shows them. */
  private topics(): Topic[] {
    const { repos } = this.deps
    return listTopics(repos.subjects.list(), (id) => repos.concepts.listBySubject(id))
  }

  current(): Topic | null {
    return currentTopic(this.topics(), this.deps.repos.settings.get().focusTopicId ?? null)
  }

  /** Where the note goes: concept and subject ids plus a name for the reply. */
  private place(input: TypedNoteInput): {
    subjectId: Id | null
    conceptId: Id | null
    where: string
  } {
    const { repos } = this.deps
    const concept = input.conceptId ? repos.concepts.get(input.conceptId) : null
    if (concept) return { subjectId: concept.subjectId, conceptId: concept.id, where: concept.name }
    const subject = input.subjectId ? repos.subjects.get(input.subjectId) : null
    const topic = this.current()
    if (subject) {
      if (topic && topic.subjectId === subject.id)
        return { subjectId: subject.id, conceptId: topic.id, where: topic.name }
      return { subjectId: subject.id, conceptId: null, where: subject.name }
    }
    if (topic) return { subjectId: topic.subjectId, conceptId: topic.id, where: topic.name }
    return { subjectId: null, conceptId: null, where: 'Loose notes' }
  }

  save(input: TypedNoteInput): SavedNote {
    const text = input.text.trim()
    if (!text) throw new Error('A note needs text')
    const { repos } = this.deps
    const place = this.place(input)
    const { note } = repos.notes.add({
      subjectId: place.subjectId,
      conceptId: place.conceptId,
      encounterId: null,
      kind: 'fact',
      text,
      source: TYPED_SOURCE,
    })
    if (!note.pinned) repos.notes.update(note.id, { pinned: true })
    this.announce(note.subjectId, note.conceptId)
    return { noteId: note.id, where: place.where }
  }

  /** Undo of a typed note: a soft delete, like any note delete. */
  undo(noteId: Id): void {
    const { repos } = this.deps
    const note = repos.notes.get(noteId)
    if (note?.status !== 'active') return
    repos.notes.remove(noteId)
    this.announce(note.subjectId, note.conceptId)
  }

  private announce(subjectId: Id | null, conceptId: Id | null): void {
    const { bus } = this.deps
    if (conceptId) bus.emit('memory:changed', { scope: 'concepts', ids: [conceptId] })
    if (subjectId) bus.emit('memory:changed', { scope: 'subjects', ids: [subjectId] })
    else bus.emit('memory:changed', { scope: 'inbox', ids: [] })
  }
}
