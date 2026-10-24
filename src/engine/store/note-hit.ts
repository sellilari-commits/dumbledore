/**
 * How a matching note shows in search (shared by the SQLite repo and the in-memory twin). The
 * app's search groups know subjects, concepts, encounters and exams, so a note shows as its
 * concept (snippet = the note) or, unplaced, as the encounter it came from; otherwise not at all.
 */
import type { Concept, Note } from '@shared/domain'
import { APP_ROUTES, type SearchHit } from '@shared/state'

export function noteSearchHit(note: Note, concept: Concept | null): SearchHit | null {
  if (concept) {
    return {
      kind: 'concept',
      id: concept.id,
      title: concept.name,
      snippet: note.text,
      subjectId: concept.subjectId,
      route: APP_ROUTES.subject(concept.subjectId, 'concepts'),
    }
  }
  if (!note.encounterId) return null
  return {
    kind: 'encounter',
    id: note.encounterId,
    title: note.source.title ?? 'Note',
    snippet: note.text,
    subjectId: note.subjectId,
    route: note.subjectId ? APP_ROUTES.subject(note.subjectId, 'seen') : APP_ROUTES.inbox,
  }
}
