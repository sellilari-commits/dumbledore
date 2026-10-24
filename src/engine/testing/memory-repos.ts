/**
 * In-memory `Repos` for unit tests and the UI demo.
 *
 * It doubles as an executable spec: lane L2 runs one conformance suite against this and the
 * SQLite implementation, so both must behave the same.
 */
import {
  type Answer,
  type Assignment,
  type ChatMessage,
  type Concept,
  type ConceptEdge,
  DEFAULT_SETTINGS,
  type Encounter,
  type Episode,
  type Id,
  type Note,
  type Nudge,
  type Profile,
  type Quiz,
  type Roadmap,
  type Settings,
  type Subject,
} from '@shared/domain'
import type { SearchHit, UsageSummary } from '@shared/state'
import { type Clock, systemClock } from '../clock'
import type { LlmCallRecord, Repos, StudyPreferences } from '../contracts'
import { newId } from '../ids'
import { foldConcepts, relinkAction, survivorParent } from '../store/concept-fold'
import { conceptKey, isNicerName } from '../store/concept-key'
import { noteSearchHit } from '../store/note-hit'
import { cleanKeywords, clipNote, sameNote } from '../store/note-key'
import { reaches } from '../store/repos/notes'

export const normalizeName = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')
const clone = <T>(value: T): T => structuredClone(value)

function must<T>(value: T | undefined, what: string): T {
  if (value === undefined) throw new Error(`${what} not found`)
  return value
}

export const EMPTY_HABITS = {
  promptsSeen: 0,
  withContext: 0,
  withStructure: 0,
  askedToBeQuizzed: 0,
  askedForExamples: 0,
}

export function createMemoryRepos(clock: Clock = systemClock): Repos {
  const subjects = new Map<Id, Subject>()
  const concepts = new Map<Id, Concept>()
  const encounters = new Map<Id, Encounter>()
  const notes = new Map<Id, Note>()
  const consolidated = new Map<Id, string>()
  const preferences = new Map<Id, StudyPreferences>()
  let edges: ConceptEdge[] = []
  const episodes = new Map<Id, Episode>()
  const roadmaps = new Map<Id, Roadmap>()
  const quizzes = new Map<Id, Quiz>()
  const assignments = new Map<Id, Assignment>()
  const nudges = new Map<Id, Nudge>()
  const chat: ChatMessage[] = []
  const usage: LlmCallRecord[] = []
  let profile: Profile = {
    aboutMe: '',
    level: null,
    promptLanguage: 'auto',
    habits: { ...EMPTY_HABITS },
    summary: '',
    updatedAt: clock.nowIso(),
  }
  let settings: Settings = clone(DEFAULT_SETTINGS)
  const now = () => clock.nowIso()

  const edgesOf = (subjectId: Id) =>
    edges.filter((e) => concepts.get(e.fromId)?.subjectId === subjectId)

  /** Same as the SQLite moveEdges (store/repos/concept-rows.ts). */
  const moveEdges = (fromId: Id, intoId: Id) => {
    const moved = edges.filter((e) => e.fromId === fromId || e.toId === fromId)
    if (moved.length === 0) return
    edges = edges.filter((e) => e.fromId !== fromId && e.toId !== fromId)
    const subjectId = must(concepts.get(intoId), `concept ${intoId}`).subjectId
    for (const e of moved) {
      const from = e.fromId === fromId ? intoId : e.fromId
      const to = e.toId === fromId ? intoId : e.toId
      if (from === to) continue
      const current = edgesOf(subjectId)
      if (current.some((x) => x.fromId === from && x.toId === to) || reaches(current, to, from))
        continue
      edges.push({ ...e, fromId: from, toId: to })
    }
  }

  /** Same as the SQLite foldConcept (store/repos/concept-rows.ts). */
  const foldConcept = (fromId: Id, intoId: Id) => {
    const from = must(concepts.get(fromId), `concept ${fromId}`)
    const into = must(concepts.get(intoId), `concept ${intoId}`)
    const merged: Concept = { ...foldConcepts(into, from), parentId: survivorParent(into, from) }
    for (const c of concepts.values())
      if (c.parentId === fromId && c.id !== intoId) c.parentId = intoId
    for (const e of encounters.values()) if (e.conceptId === fromId) e.conceptId = intoId
    for (const n of notes.values())
      if (n.conceptId === fromId) Object.assign(n, { conceptId: intoId, subjectId: into.subjectId })
    moveEdges(fromId, intoId)
    for (const q of quizzes.values())
      for (const question of q.questions)
        if (question.conceptId === fromId) question.conceptId = intoId
    for (const m of chat) m.actions = m.actions.map((a) => relinkAction(a, fromId, intoId) ?? a)
    for (const n of nudges.values())
      if (n.action) n.action = relinkAction(n.action, fromId, intoId) ?? n.action
    concepts.delete(fromId)
    concepts.set(intoId, merged)
  }

  const repos: Repos = {
    subjects: {
      list(filter) {
        return [...subjects.values()]
          .filter((s) => !filter?.status || filter.status.includes(s.status))
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(clone)
      },
      get: (id) => clone(subjects.get(id) ?? null),
      findByName(name) {
        const n = normalizeName(name)
        return clone([...subjects.values()].find((s) => normalizeName(s.name) === n) ?? null)
      },
      create(input) {
        const t = now()
        const subject: Subject = {
          id: newId('sub'),
          name: input.name.trim(),
          emoji: input.emoji ?? '📘',
          color: input.color ?? 'default',
          description: input.description ?? '',
          goal: input.goal ?? null,
          deadline: input.deadline ?? null,
          status: input.status ?? 'active',
          focus: 'normal',
          createdAt: t,
          updatedAt: t,
        }
        subjects.set(subject.id, subject)
        return clone(subject)
      },
      update(id, patch) {
        const current = must(subjects.get(id), `subject ${id}`)
        const next: Subject = {
          ...current,
          ...patch,
          id,
          createdAt: current.createdAt,
          updatedAt: now(),
        }
        subjects.set(id, next)
        return clone(next)
      },
      merge(fromId, intoId) {
        must(subjects.get(fromId), `subject ${fromId}`)
        must(subjects.get(intoId), `subject ${intoId}`)
        if (fromId === intoId) return
        const folds: [Id, Id][] = []
        for (const c of [...concepts.values()].filter((c) => c.subjectId === fromId)) {
          const key = conceptKey(c.name)
          const twin = [...concepts.values()].find(
            (x) => x.subjectId === intoId && conceptKey(x.name) === key,
          )
          if (twin) folds.push([c.id, twin.id])
          else concepts.set(c.id, { ...c, subjectId: intoId })
        }
        for (const [from, into] of folds) foldConcept(from, into)
        for (const e of encounters.values()) if (e.subjectId === fromId) e.subjectId = intoId
        for (const r of roadmaps.values()) if (r.subjectId === fromId) r.subjectId = intoId
        for (const q of quizzes.values()) {
          q.subjectIds = [...new Set(q.subjectIds.map((s) => (s === fromId ? intoId : s)))]
        }
        for (const a of assignments.values()) if (a.subjectId === fromId) a.subjectId = intoId
        for (const n of notes.values()) if (n.subjectId === fromId) n.subjectId = intoId
        subjects.delete(fromId)
      },
      remove(id) {
        must(subjects.get(id), `subject ${id}`)
        const episodeIds = new Set<Id>()
        for (const e of [...encounters.values()]) {
          if (e.subjectId !== id) continue
          if (e.episodeId) episodeIds.add(e.episodeId)
          encounters.delete(e.id)
        }
        for (const episodeId of episodeIds)
          if (![...encounters.values()].some((e) => e.episodeId === episodeId))
            episodes.delete(episodeId)
        const conceptIds = new Set(
          [...concepts.values()].filter((c) => c.subjectId === id).map((c) => c.id),
        )
        for (const c of concepts.values())
          if (c.parentId && conceptIds.has(c.parentId)) c.parentId = null
        for (const e of encounters.values())
          if (e.conceptId && conceptIds.has(e.conceptId)) e.conceptId = null
        for (const cid of conceptIds) concepts.delete(cid)
        edges = edges.filter((e) => !conceptIds.has(e.fromId) && !conceptIds.has(e.toId))
        for (const n of [...notes.values()]) if (n.subjectId === id) notes.delete(n.id)
        for (const n of notes.values())
          if (n.conceptId && conceptIds.has(n.conceptId)) n.conceptId = null
        for (const r of [...roadmaps.values()]) if (r.subjectId === id) roadmaps.delete(r.id)
        for (const a of [...assignments.values()]) if (a.subjectId === id) assignments.delete(a.id)
        for (const q of [...quizzes.values()]) {
          if (!q.subjectIds.includes(id)) continue
          q.subjectIds = q.subjectIds.filter((s) => s !== id)
          if (q.subjectIds.length === 0) quizzes.delete(q.id)
        }
        for (let i = chat.length - 1; i >= 0; i--)
          if (chat[i]?.thread === `subject:${id}`) chat.splice(i, 1)
        for (const n of [...nudges.values()])
          if (JSON.stringify(n.action ?? null).includes(`"${id}"`)) nudges.delete(n.id)
        subjects.delete(id)
        consolidated.delete(id)
        preferences.delete(id)
      },
      consolidatedAt: (id) => consolidated.get(id) ?? null,
      markConsolidated(id, at) {
        must(subjects.get(id), `subject ${id}`)
        consolidated.set(id, at)
      },
      studyPreferences: (id) => clone(preferences.get(id) ?? null),
      setStudyPreferences(id, prefs) {
        must(subjects.get(id), `subject ${id}`)
        if (prefs) preferences.set(id, clone(prefs))
        else preferences.delete(id)
      },
    },

    concepts: {
      listBySubject: (subjectId) =>
        [...concepts.values()].filter((c) => c.subjectId === subjectId).map(clone),
      get: (id) => clone(concepts.get(id) ?? null),
      findByName(subjectId, name) {
        const key = conceptKey(name)
        return clone(
          [...concepts.values()].find(
            (c) => c.subjectId === subjectId && conceptKey(c.name) === key,
          ) ?? null,
        )
      },
      upsert(input) {
        const existing = repos.concepts.findByName(input.subjectId, input.name)
        if (existing) {
          const patch: { name?: string; summary?: string } = {}
          if (isNicerName(existing.name, input.name)) patch.name = input.name.trim()
          if (input.summary && !existing.summary) patch.summary = input.summary
          return Object.keys(patch).length > 0
            ? repos.concepts.update(existing.id, patch)
            : existing
        }
        const parentName = input.parentName?.trim() ? input.parentName : null
        const parent =
          parentName && conceptKey(parentName) !== conceptKey(input.name)
            ? repos.concepts.upsert({ subjectId: input.subjectId, name: parentName })
            : null
        const concept: Concept = {
          id: newId('con'),
          subjectId: input.subjectId,
          parentId: parent?.id ?? null,
          name: input.name.trim(),
          summary: input.summary ?? '',
          mastery: 0,
          box: 0,
          nextReviewAt: null,
          status: 'new',
          struggleCount: 0,
          lastSeenAt: null,
        }
        concepts.set(concept.id, concept)
        return clone(concept)
      },
      update(id, patch) {
        const current = must(concepts.get(id), `concept ${id}`)
        const next: Concept = { ...current, ...patch, id }
        if (!next.summaryPinned) delete next.summaryPinned // like SQLite: present only when true
        concepts.set(id, next)
        return clone(next)
      },
      listDue(nowIso, limit) {
        return [...concepts.values()]
          .filter((c) => c.nextReviewAt !== null && c.nextReviewAt <= nowIso)
          .sort((a, b) => (a.nextReviewAt ?? '').localeCompare(b.nextReviewAt ?? ''))
          .slice(0, limit)
          .map(clone)
      },
      listStruggling(limit) {
        return [...concepts.values()]
          .filter((c) => c.status === 'struggling')
          .sort((a, b) => b.struggleCount - a.struggleCount || a.mastery - b.mastery)
          .slice(0, limit)
          .map(clone)
      },
      remove(id) {
        const concept = must(concepts.get(id), `concept ${id}`)
        for (const n of notes.values()) {
          if (n.conceptId !== id) continue
          if (n.status === 'active') Object.assign(n, { status: 'deleted', updatedAt: now() })
          n.conceptId = null
        }
        for (const c of concepts.values()) if (c.parentId === id) c.parentId = concept.parentId
        for (const e of encounters.values()) if (e.conceptId === id) e.conceptId = null
        for (const q of quizzes.values())
          for (const question of q.questions)
            if (question.conceptId === id) question.conceptId = null
        edges = edges.filter((e) => e.fromId !== id && e.toId !== id)
        concepts.delete(id)
      },
    },

    encounters: {
      add(input) {
        const encounter: Encounter = {
          ...clone(input),
          id: newId('enc'),
          inboxState: input.inboxState ?? 'new',
          createdAt: now(),
        }
        encounters.set(encounter.id, encounter)
        return clone(encounter)
      },
      list(filter) {
        return [...encounters.values()]
          .filter((e) => filter.subjectId == null || e.subjectId === filter.subjectId)
          .filter((e) => filter.inboxState == null || e.inboxState === filter.inboxState)
          .filter((e) => !filter.sinceIso || e.createdAt >= filter.sinceIso)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id))
          .slice(0, filter.limit ?? Number.POSITIVE_INFINITY)
          .map(clone)
      },
      setInboxState(id, state, subjectId) {
        const current = must(encounters.get(id), `encounter ${id}`)
        const next: Encounter = {
          ...current,
          inboxState: state,
          subjectId: subjectId === undefined ? current.subjectId : subjectId,
        }
        encounters.set(id, next)
        return clone(next)
      },
      openQuestions(subjectId, limit) {
        const seen = new Set<string>()
        const out: string[] = []
        for (const e of repos.encounters.list({ subjectId })) {
          if (e.inboxState === 'ignored') continue
          for (const q of e.openQuestions) {
            const key = normalizeName(q)
            if (seen.has(key)) continue
            seen.add(key)
            out.push(q)
            if (out.length >= limit) return out
          }
        }
        return out
      },
      remove(id) {
        const encounter = must(encounters.get(id), `encounter ${id}`)
        for (const n of notes.values())
          if (n.encounterId === id && n.status === 'active')
            Object.assign(n, { status: 'deleted', updatedAt: now() })
        encounters.delete(id)
        const episodeId = encounter.episodeId
        if (episodeId && ![...encounters.values()].some((e) => e.episodeId === episodeId))
          episodes.delete(episodeId)
      },
    },

    notes: {
      add(input) {
        const text = clipNote(input.text)
        if (!text) throw new Error('A note needs text')
        const twin = [...notes.values()].find(
          (n) =>
            n.status === 'active' &&
            (input.conceptId
              ? n.conceptId === input.conceptId
              : n.conceptId === null && n.subjectId === input.subjectId) &&
            sameNote(n.text, text),
        )
        if (twin) {
          twin.keywords = cleanKeywords(twin.keywords, input.keywords)
          twin.updatedAt = now()
          return { note: clone(twin), created: false }
        }
        const t = now()
        const note: Note = {
          id: newId('not'),
          subjectId: input.subjectId,
          conceptId: input.conceptId,
          encounterId: input.encounterId,
          kind: input.kind,
          text,
          keywords: cleanKeywords(input.keywords),
          source: clone(input.source),
          status: 'active',
          mergedInto: null,
          pinned: false,
          createdAt: t,
          updatedAt: t,
        }
        notes.set(note.id, note)
        return { note: clone(note), created: true }
      },
      get: (id) => clone(notes.get(id) ?? null),
      list(filter) {
        const status = filter.status === undefined ? 'active' : filter.status
        const list = [...notes.values()].filter(
          (n) =>
            (filter.subjectId === undefined || n.subjectId === filter.subjectId) &&
            (filter.conceptId === undefined || n.conceptId === filter.conceptId) &&
            (filter.encounterId === undefined || n.encounterId === filter.encounterId) &&
            (status === null || n.status === status),
        )
        return list.slice(0, filter.limit ?? list.length).map(clone)
      },
      update(id, patch) {
        const current = must(notes.get(id), `note ${id}`)
        const { id: _i, createdAt: _c, updatedAt: _u, ...rest } = patch as Partial<Note>
        if (typeof rest.text === 'string') {
          rest.text = clipNote(rest.text)
          if (!rest.text) throw new Error('A note needs text')
        }
        if (rest.keywords) rest.keywords = cleanKeywords(rest.keywords)
        const next: Note = { ...current, ...rest, id, updatedAt: now() }
        notes.set(id, next)
        return clone(next)
      },
      remove(id) {
        repos.notes.update(id, { status: 'deleted' })
      },
      merge(fromId, intoId, text) {
        must(notes.get(fromId), `note ${fromId}`)
        must(notes.get(intoId), `note ${intoId}`)
        if (fromId === intoId) return clone(must(notes.get(intoId), `note ${intoId}`))
        repos.notes.update(fromId, { status: 'merged', mergedInto: intoId })
        return text?.trim()
          ? repos.notes.update(intoId, { text })
          : clone(must(notes.get(intoId), 'note'))
      },
    },

    edges: {
      list: (subjectId) => clone(edgesOf(subjectId)),
      add(input) {
        const { fromId, toId } = input
        if (fromId === toId) return null
        const from = must(concepts.get(fromId), `concept ${fromId}`)
        const to = must(concepts.get(toId), `concept ${toId}`)
        if (from.subjectId !== to.subjectId) return null
        const current = edgesOf(from.subjectId)
        if (current.some((e) => e.fromId === fromId && e.toId === toId)) return null
        if (reaches(current, toId, fromId)) return null
        const edge: ConceptEdge = {
          fromId,
          toId,
          why: input.why?.trim() ?? '',
          source: input.source ?? 'llm',
          createdAt: now(),
        }
        edges.push(edge)
        return clone(edge)
      },
      remove(fromId, toId) {
        edges = edges.filter((e) => !(e.fromId === fromId && e.toId === toId))
      },
    },

    episodes: {
      save: (episode) => void episodes.set(episode.id, clone(episode)),
      get: (id) => clone(episodes.get(id) ?? null),
      listUnextracted: (limit) =>
        [...episodes.values()]
          .filter((e) => !e.extracted)
          .sort((a, b) => a.endedAt.localeCompare(b.endedAt))
          .slice(0, limit)
          .map(clone),
      markExtracted(id) {
        const e = must(episodes.get(id), `episode ${id}`)
        e.extracted = true
      },
      recent: (filter) =>
        [...episodes.values()]
          .filter((e) => e.endedAt >= filter.sinceIso)
          .sort((a, b) => b.endedAt.localeCompare(a.endedAt))
          .slice(0, filter.limit ?? Number.POSITIVE_INFINITY)
          .map(clone),
      purgeTextOlderThan(iso) {
        let n = 0
        for (const e of episodes.values()) {
          if (e.endedAt < iso && e.text !== '') {
            e.text = ''
            n++
          }
        }
        return n
      },
    },

    roadmaps: {
      get: (id) => clone(roadmaps.get(id) ?? null),
      getActive: (subjectId) =>
        clone(
          [...roadmaps.values()]
            .filter((r) => r.subjectId === subjectId && r.status !== 'done')
            .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null,
        ),
      listBySubject: (subjectId) =>
        [...roadmaps.values()]
          .filter((r) => r.subjectId === subjectId)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .map(clone),
      listActive: () =>
        [...roadmaps.values()]
          .filter((r) => r.status === 'active')
          .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
          .map(clone),
      save: (roadmap) => void roadmaps.set(roadmap.id, clone(roadmap)),
    },

    quizzes: {
      get: (id) => clone(quizzes.get(id) ?? null),
      save: (quiz) => void quizzes.set(quiz.id, clone(quiz)),
      list: (filter) =>
        [...quizzes.values()]
          .filter((q) => !filter.kind || q.kind === filter.kind)
          .filter((q) => !filter.subjectId || q.subjectIds.includes(filter.subjectId))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
          .slice(0, filter.limit ?? Number.POSITIVE_INFINITY)
          .map(clone),
      recordAnswer(quizId, answer: Answer) {
        const quiz = must(quizzes.get(quizId), `quiz ${quizId}`)
        quiz.answers = [...quiz.answers.filter((a) => a.questionId !== answer.questionId), answer]
        if (quiz.status === 'ready') quiz.status = 'in_progress'
        return clone(quiz)
      },
    },

    assignments: {
      upsert(input) {
        const key = normalizeName(input.title)
        const twin = [...assignments.values()].find(
          (a) => normalizeName(a.title) === key && (a.dueAt ?? '') === (input.dueAt ?? ''),
        )
        if (twin) return clone(twin)
        const assignment: Assignment = {
          id: newId('asg'),
          subjectId: input.subjectId,
          title: input.title.trim(),
          course: input.course ?? null,
          dueAt: input.dueAt,
          source: input.source,
          status: 'open',
          createdAt: now(),
        }
        assignments.set(assignment.id, assignment)
        return clone(assignment)
      },
      list: (filter) =>
        [...assignments.values()]
          .filter((a) => !filter.status || a.status === filter.status)
          .filter((a) => !filter.subjectId || a.subjectId === filter.subjectId)
          .sort((a, b) => (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
          .slice(0, filter.limit ?? Number.POSITIVE_INFINITY)
          .map(clone),
      update(id, patch) {
        const current = must(assignments.get(id), `assignment ${id}`)
        const next = { ...current, ...patch, id }
        assignments.set(id, next)
        return clone(next)
      },
    },

    nudges: {
      add(input) {
        const nudge: Nudge = {
          ...clone(input),
          id: newId('ndg'),
          createdAt: now(),
          shownAt: null,
          outcome: 'pending',
        }
        nudges.set(nudge.id, nudge)
        return clone(nudge)
      },
      update(id, patch) {
        const current = must(nudges.get(id), `nudge ${id}`)
        const next = { ...current, ...patch, id }
        nudges.set(id, next)
        return clone(next)
      },
      listSince: (iso) =>
        [...nudges.values()]
          .filter((n) => n.createdAt >= iso)
          .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
          .map(clone),
      findByDedupeKey: (key, sinceIso) =>
        clone(
          [...nudges.values()].find((n) => n.dedupeKey === key && n.createdAt >= sinceIso) ?? null,
        ),
    },

    chat: {
      append(input) {
        const message: ChatMessage = { ...clone(input), id: newId('msg'), createdAt: now() }
        chat.push(message)
        return clone(message)
      },
      history: (thread, limit) =>
        chat
          .filter((m) => m.thread === thread)
          .slice(-limit)
          .map(clone),
    },

    profile: {
      get: () => clone(profile),
      update(patch) {
        profile = { ...profile, ...clone(patch), updatedAt: now() }
        return clone(profile)
      },
    },

    settings: {
      get: () => clone(settings),
      update(patch) {
        settings = { ...settings, ...clone(patch) }
        return clone(settings)
      },
    },

    usage: {
      record: (call) => void usage.push({ ...call }),
      rowsSince(sinceIso) {
        const rows = new Map<string, UsageSummary['rows'][number]>()
        for (const c of usage.filter((u) => u.at >= sinceIso)) {
          const key = `${c.provider}|${c.model}`
          const row = rows.get(key) ?? {
            provider: c.provider,
            model: c.model,
            calls: 0,
            failures: 0,
            tokensIn: 0,
            tokensOut: 0,
          }
          row.calls++
          if (!c.ok) row.failures++
          row.tokensIn += c.tokensIn
          row.tokensOut += c.tokensOut
          rows.set(key, row)
        }
        return [...rows.values()]
      },
      countSince(provider, model, sinceIso) {
        const calls = usage.filter(
          (u) => u.provider === provider && u.model === model && u.at >= sinceIso,
        )
        return {
          requests: calls.length,
          tokens: calls.reduce((n, c) => n + c.tokensIn + c.tokensOut, 0),
        }
      },
    },

    search: {
      query(q, limit) {
        const n = normalizeName(q)
        if (!n) return []
        const hits: SearchHit[] = []
        const has = (...texts: (string | null | undefined)[]) =>
          texts.some((t) => t && normalizeName(t).includes(n))
        for (const s of subjects.values()) {
          if (has(s.name, s.description, s.goal))
            hits.push({
              kind: 'subject',
              id: s.id,
              title: `${s.emoji} ${s.name}`,
              snippet: s.goal ?? s.description,
              subjectId: s.id,
              route: `/subjects/${s.id}/roadmap`,
            })
        }
        for (const c of concepts.values()) {
          if (has(c.name, c.summary))
            hits.push({
              kind: 'concept',
              id: c.id,
              title: c.name,
              snippet: c.summary,
              subjectId: c.subjectId,
              route: `/subjects/${c.subjectId}/concepts`,
            })
        }
        for (const e of encounters.values()) {
          if (e.inboxState !== 'ignored' && has(e.seen, e.bigPicture, e.topicPath.join(' ')))
            hits.push({
              kind: 'encounter',
              id: e.id,
              title: e.topicPath.at(-1) ?? e.source.title ?? 'Seen',
              snippet: e.seen.slice(0, 140),
              subjectId: e.subjectId,
              route: e.subjectId ? `/subjects/${e.subjectId}/seen` : '/inbox',
            })
        }
        for (const quiz of quizzes.values()) {
          if (quiz.kind === 'exam' && has(quiz.title))
            hits.push({
              kind: 'exam',
              id: quiz.id,
              title: quiz.title,
              snippet: `${quiz.questions.length} questions`,
              subjectId: quiz.subjectIds[0] ?? null,
              route: `/exams/${quiz.id}`,
            })
        }
        for (const note of notes.values()) {
          if (note.status !== 'active' || !has(note.text)) continue
          const hit = noteSearchHit(
            note,
            note.conceptId ? (concepts.get(note.conceptId) ?? null) : null,
          )
          if (hit && !hits.some((h) => h.kind === hit.kind && h.id === hit.id)) hits.push(hit)
        }
        return hits.slice(0, limit)
      },
    },

    transaction: (fn) => fn(),
  }
  return repos
}
