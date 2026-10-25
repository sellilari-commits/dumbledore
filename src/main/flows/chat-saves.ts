/**
 * What talking to Dumbledore (the double-tap chat) saves into the student's studying, at once and
 * with a receipt line in the reply:
 * - save_question: an open question on the topic (a pinned 'question' note, which prompts,
 *   outlines and Your gaps pick up) and, when the student is stuck, the topic marked as a gap
 *   (struggling, struggleCount + 1). The topic is the one the coach named by id, else by name
 *   (created under the subject when new), else the current topic of that subject.
 * - update_subject: the subject's goal, exam / deadline date or what the course covers; when its
 *   roadmap runs, an "Update roadmap" chip offers to plan it again around the new goal.
 * - add_note: a note the student asked to keep (TypedNotes), undone with undo_note.
 * Each save returns its Undo action; undo puts back what was there. Undo entries live for this run
 * of the app.
 */
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { CoachAction, Concept, Id, Note, Subject } from '@shared/domain'
import { lastStudiedSubject } from '../router/last-subject'
import type { TypedNotes } from './typed-notes'

export const ASKED_SOURCE: Note['source'] = {
  app: 'Dumbledore',
  bundleId: null,
  url: null,
  title: 'Asked Dumbledore',
}

export interface ChatSavesDeps {
  repos: Pick<Repos, 'notes' | 'subjects' | 'concepts' | 'settings' | 'roadmaps' | 'encounters'>
  bus: EngineBus
  notes: Pick<TypedNotes, 'save' | 'current'>
}

export interface Receipt {
  /** One line for the reply, e.g. "Saved to Organic Chemistry › SN1: open question “…”". */
  line: string
  /** Undo chip; null when nothing was saved. */
  undo: CoachAction | null
  /** Further chips the save makes sensible (re-plan the roadmap after a new goal). */
  more: CoachAction[]
}

const short = (text: string, max = 80) => {
  const clean = text.replace(/\s+/g, ' ').trim()
  return clean.length <= max ? clean : `${clean.slice(0, max - 1).trimEnd()}…`
}

/** "2026-12-12" → "12 Dec 2026". */
function day(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

export class ChatSaves {
  private readonly undos = new Map<string, () => void>()
  private seq = 0

  constructor(private readonly deps: ChatSavesDeps) {}

  /** Applies a save action; null for any other action (it stays a chip). */
  apply(action: CoachAction): Receipt | null {
    switch (action.type) {
      case 'save_question':
        return this.saveQuestion(action)
      case 'update_subject':
        return this.updateSubject(action)
      case 'add_note': {
        const text = action.text.trim()
        if (!text) return null
        const saved = this.deps.notes.save(action)
        return {
          line: `Saved to ${saved.where}: “${short(text)}”`,
          undo: { type: 'undo_note', noteId: saved.noteId },
          more: [],
        }
      }
      default:
        return null
    }
  }

  /** Undoes a save from this run; false when it is unknown (already undone, or the app restarted). */
  undo(saveId: string): boolean {
    const run = this.undos.get(saveId)
    if (!run) return false
    this.undos.delete(saveId)
    run()
    return true
  }

  private remember(run: () => void): CoachAction {
    const saveId = `save_${Date.now().toString(36)}_${++this.seq}`
    this.undos.set(saveId, run)
    return { type: 'undo_save', saveId }
  }

  private changed(subjectId: Id | null, conceptId: Id | null): void {
    const { bus } = this.deps
    if (conceptId) bus.emit('memory:changed', { scope: 'concepts', ids: [conceptId] })
    if (subjectId) bus.emit('memory:changed', { scope: 'subjects', ids: [subjectId] })
  }

  /**
   * The subject a question belongs to: the concept's, else named, else the current topic's, else
   * the focus subject, the one studied last, the newest one. A best guess beats asking: the
   * receipt names it and Undo takes it back.
   */
  private subjectFor(subjectId: Id | null, concept: Concept | null): Subject | null {
    const { repos, notes } = this.deps
    if (concept) return repos.subjects.get(concept.subjectId)
    const named = subjectId ? repos.subjects.get(subjectId) : null
    if (named) return named
    const topic = notes.current()
    if (topic) return repos.subjects.get(topic.subjectId)
    const guess = repos.settings.get().focusSubjectId ?? lastStudiedSubject(repos)
    if (guess) return repos.subjects.get(guess)
    return repos.subjects.list({ status: ['active'] }).at(-1) ?? null
  }

  private saveQuestion(action: Extract<CoachAction, { type: 'save_question' }>): Receipt {
    const { repos, notes } = this.deps
    const text = action.text.trim()
    const named = action.conceptId ? repos.concepts.get(action.conceptId) : null
    const subject = this.subjectFor(action.subjectId, named)
    if (!text || !subject) {
      return { line: 'Not saved: which subject is this about?', undo: null, more: [] }
    }
    let concept: Concept | null = named
    let created = false
    if (!concept && action.topic?.trim()) {
      concept = repos.concepts.findByName(subject.id, action.topic)
      if (!concept) {
        concept = repos.concepts.upsert({ subjectId: subject.id, name: action.topic.trim() })
        created = true
      }
    }
    if (!concept) {
      const topic = notes.current()
      if (topic && topic.subjectId === subject.id) concept = repos.concepts.get(topic.id)
    }
    const { note } = repos.notes.add({
      subjectId: subject.id,
      conceptId: concept?.id ?? null,
      encounterId: null,
      kind: 'question',
      text,
      source: ASKED_SOURCE,
    })
    if (!note.pinned) repos.notes.update(note.id, { pinned: true })
    const before = concept ? { status: concept.status, struggleCount: concept.struggleCount } : null
    if (concept && action.stuck) {
      repos.concepts.update(concept.id, {
        status: 'struggling',
        struggleCount: concept.struggleCount + 1,
      })
    }
    this.changed(subject.id, concept?.id ?? null)
    const conceptId = concept?.id ?? null
    const undo = this.remember(() => {
      repos.notes.remove(note.id)
      if (conceptId && created) repos.concepts.remove(conceptId)
      else if (conceptId && before && action.stuck) repos.concepts.update(conceptId, before)
      this.changed(subject.id, conceptId)
    })
    const where = concept ? `${subject.name} › ${concept.name}` : subject.name
    const gap = concept && action.stuck ? ' · marked as a gap' : ''
    return { line: `Saved to ${where}: open question “${short(text)}”${gap}`, undo, more: [] }
  }

  private updateSubject(action: Extract<CoachAction, { type: 'update_subject' }>): Receipt {
    const { repos } = this.deps
    const subject = repos.subjects.get(action.subjectId)
    if (!subject) return { line: 'Not saved: which subject is this about?', undo: null, more: [] }
    const goal = action.goal?.trim() || null
    const deadline = action.deadline?.trim() || null
    const scope = action.scope?.trim() || null
    const patch: Partial<Pick<Subject, 'goal' | 'deadline' | 'description'>> = {}
    const parts: string[] = []
    if (goal && goal !== subject.goal) {
      patch.goal = goal
      parts.push(`goal “${short(goal, 60)}”`)
    }
    if (deadline && deadline !== subject.deadline?.slice(0, 10)) {
      patch.deadline = deadline
      parts.push(`deadline ${day(deadline)}`)
    }
    if (scope && scope !== subject.description) {
      patch.description = scope
      parts.push(`covers “${short(scope, 60)}”`)
    }
    if (parts.length === 0) return { line: '', undo: null, more: [] }
    const before = {
      goal: subject.goal,
      deadline: subject.deadline,
      description: subject.description,
    }
    repos.subjects.update(subject.id, patch)
    this.changed(subject.id, null)
    const undo = this.remember(() => {
      repos.subjects.update(subject.id, before)
      this.changed(subject.id, null)
    })
    const more: CoachAction[] = []
    const replan = patch.goal ?? patch.description
    if (replan && repos.roadmaps.getActive(subject.id)) {
      more.push({ type: 'adjust_roadmap', subjectId: subject.id, instruction: replan })
    }
    return { line: `Saved to ${subject.name}: ${parts.join(', ')}`, undo, more }
  }
}
