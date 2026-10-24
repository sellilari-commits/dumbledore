/**
 * Read models for the mock API, derived from the in-memory database the same way the engine
 * derives them: subject summaries, Home, subject detail, exams list, search, picker, session.
 */
import type { Quiz, Roadmap, Subject, SubjectSummary } from '@shared/domain'
import type {
  HomeData,
  PickerData,
  QuizSummary,
  SearchHit,
  SessionState,
  SubjectDetail,
} from '@shared/state'
import type { MockDb } from './db'

function endOfToday(): number {
  const d = new Date()
  d.setHours(23, 59, 59, 999)
  return d.getTime()
}

export function roadmapFor(db: MockDb, subjectId: string): Roadmap | null {
  const list = db.roadmaps.filter((r) => r.subjectId === subjectId && r.status !== 'done')
  return list.find((r) => r.status === 'active') ?? list[0] ?? null
}

export function dueConcepts(db: MockDb, subjectId?: string) {
  const limit = endOfToday()
  return db.concepts.filter(
    (c) =>
      (subjectId === undefined || c.subjectId === subjectId) &&
      c.nextReviewAt !== null &&
      new Date(c.nextReviewAt).getTime() <= limit,
  )
}

export function summarize(db: MockDb, s: Subject): SubjectSummary {
  const concepts = db.concepts.filter((c) => c.subjectId === s.id)
  const roadmap = roadmapFor(db, s.id)
  const done = roadmap ? roadmap.items.filter((i) => i.status === 'done').length : 0
  const encounters = db.encounters.filter((e) => e.subjectId === s.id)
  const last = encounters.map((e) => e.createdAt).sort().pop() ?? null
  return {
    ...s,
    progress: roadmap && roadmap.items.length > 0 ? done / roadmap.items.length : 0,
    mastery: concepts.length ? concepts.reduce((a, c) => a + c.mastery, 0) / concepts.length : 0,
    dueReviews: dueConcepts(db, s.id).length,
    openQuestions: encounters.reduce((a, e) => a + e.openQuestions.length, 0),
    studyMinutesWeek: db.weekMinutes[s.id] ?? 0,
    lastStudiedAt: last,
  }
}

export function subjectList(db: MockDb): SubjectSummary[] {
  return db.subjects.filter((s) => s.status !== 'archived').map((s) => summarize(db, s))
}

export function quizSummary(q: Quiz): QuizSummary {
  return {
    id: q.id,
    kind: q.kind,
    title: q.title,
    subjectIds: q.subjectIds,
    score: q.score,
    questionCount: q.questions.length,
    createdAt: q.createdAt,
    completedAt: q.completedAt,
  }
}

export function examList(db: MockDb): QuizSummary[] {
  return db.quizzes
    .filter((q) => q.kind === 'exam' || q.kind === 'review')
    .map(quizSummary)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

function emojiOf(db: MockDb, subjectId: string | null): string {
  return db.subjects.find((s) => s.id === subjectId)?.emoji ?? '📄'
}

export function homeData(db: MockDb): HomeData {
  const active = db.subjects.filter((s) => s.status === 'active')
  const activeIds = new Set(active.map((s) => s.id))
  const continueList = db.roadmaps
    .filter((r) => r.status !== 'done' && activeIds.has(r.subjectId))
    .map((r) => {
      const s = db.subjects.find((x) => x.id === r.subjectId)
      const current = r.items.findIndex((i) => i.status === 'current')
      return {
        roadmapId: r.id,
        subjectId: r.subjectId,
        subjectName: s?.name ?? '',
        subjectEmoji: s?.emoji ?? '📄',
        title: r.title,
        index: current < 0 ? r.items.filter((i) => i.status === 'done').length : current,
        total: r.items.length,
      }
    })
  const due = dueConcepts(db).filter((c) => activeIds.has(c.subjectId))
  const struggling = db.concepts.filter((c) => c.status === 'struggling' && activeIds.has(c.subjectId))
  const deadlines = [
    ...db.assignments
      .filter((a) => a.status === 'open' && a.dueAt)
      .map((a) => ({
        id: a.id,
        title: a.title,
        dueAt: a.dueAt ?? '',
        kind: 'assignment' as const,
        subjectId: a.subjectId,
        subjectEmoji: a.subjectId ? emojiOf(db, a.subjectId) : null,
      })),
    ...active
      .filter((s) => s.deadline)
      .map((s) => ({
        id: s.id,
        title: `${s.name} · ${s.goal ?? 'deadline'}`,
        dueAt: s.deadline ?? '',
        kind: 'subject' as const,
        subjectId: s.id,
        subjectEmoji: s.emoji,
      })),
  ].sort((a, b) => a.dueAt.localeCompare(b.dueAt))
  return {
    greetingName: 'Ilari',
    continue: continueList,
    dueReviews: due.map((c) => ({
      conceptId: c.id,
      conceptName: c.name,
      subjectId: c.subjectId,
      subjectEmoji: emojiOf(db, c.subjectId),
    })),
    struggling: struggling.map((c) => ({
      conceptId: c.id,
      conceptName: c.name,
      subjectId: c.subjectId,
      subjectEmoji: emojiOf(db, c.subjectId),
      reason:
        c.struggleCount > 1
          ? `Missed ${c.struggleCount} times recently`
          : 'Re-read several times without it clicking',
    })),
    deadlines,
    week: {
      minutesBySubject: active
        .map((s) => ({ subjectId: s.id, name: s.name, emoji: s.emoji, minutes: db.weekMinutes[s.id] ?? 0 }))
        .filter((m) => m.minutes > 0),
      questionsAnswered: db.questionsAnswered,
      accuracy: db.questionsAnswered ? db.correct / db.questionsAnswered : null,
    },
    habits: db.profile.habits,
  }
}

export function subjectDetail(db: MockDb, id: string): SubjectDetail {
  const s = db.subjects.find((x) => x.id === id)
  if (!s) throw new Error(`No subject with id ${id}`)
  return {
    subject: summarize(db, s),
    roadmap: roadmapFor(db, id),
    concepts: db.concepts.filter((c) => c.subjectId === id),
    encounters: db.encounters
      .filter((e) => e.subjectId === id && e.inboxState !== 'ignored')
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    exams: db.quizzes.filter((q) => q.subjectIds.includes(id)).map(quizSummary),
    assignments: db.assignments.filter((a) => a.subjectId === id),
  }
}

export function search(db: MockDb, query: string): SearchHit[] {
  const q = query.trim().toLowerCase()
  if (!q) return []
  const hit = (text: string) => text.toLowerCase().includes(q)
  const hits: SearchHit[] = []
  for (const s of db.subjects)
    if (hit(s.name) || hit(s.description))
      hits.push({ kind: 'subject', id: s.id, title: `${s.emoji} ${s.name}`, snippet: s.description, subjectId: s.id, route: `/subjects/${s.id}/roadmap` })
  for (const c of db.concepts)
    if (hit(c.name) || hit(c.summary))
      hits.push({ kind: 'concept', id: c.id, title: c.name, snippet: c.summary, subjectId: c.subjectId, route: `/subjects/${c.subjectId}/concepts` })
  for (const e of db.encounters)
    if (hit(e.seen) || hit(e.source.title ?? ''))
      hits.push({ kind: 'encounter', id: e.id, title: e.source.title ?? e.source.app, snippet: e.seen, subjectId: e.subjectId, route: e.subjectId ? `/subjects/${e.subjectId}/seen` : '/inbox' })
  for (const x of db.quizzes)
    if (hit(x.title))
      hits.push({ kind: 'exam', id: x.id, title: x.title, snippet: `${x.questions.length} questions`, subjectId: x.subjectIds[0] ?? null, route: `/exams/${x.id}` })
  return hits.slice(0, 20)
}

export function picker(db: MockDb): PickerData {
  return {
    subjects: subjectList(db)
      .filter((s) => s.status === 'active')
      .sort((a, b) => (a.focus === 'focus' ? -1 : b.focus === 'focus' ? 1 : b.dueReviews - a.dueReviews))
      .map((s) => ({
        subject: s,
        questions: db.encounters
          .filter((e) => e.subjectId === s.id)
          .flatMap((e) => e.openQuestions)
          .slice(0, 3),
        hasActiveRoadmap: roadmapFor(db, s.id) !== null,
      })),
  }
}

export function sessionState(db: MockDb): SessionState | null {
  const r = db.roadmaps.find((x) => x.id === db.sessionRoadmapId)
  if (!r) return null
  const s = db.subjects.find((x) => x.id === r.subjectId)
  const index = r.items.findIndex((i) => i.status === 'current')
  const current = r.items[index]
  const derived: SessionState['phase'] =
    index < 0 ? 'complete' : current?.kind === 'checkpoint' ? 'checkpoint' : 'step'
  const phase = db.sessionPhase ?? derived
  return {
    roadmapId: r.id,
    subjectId: r.subjectId,
    subjectName: s?.name ?? '',
    subjectEmoji: s?.emoji ?? '📄',
    title: r.title,
    phase,
    index: index < 0 ? r.items.length : index,
    total: r.items.length,
    items: r.items,
    nextAction:
      phase === 'planning' ? 'none' : phase === 'checkpoint' ? 'open_quiz' : phase === 'complete' ? 'finish' : 'paste_next',
    assistant: db.appState.aiChat?.provider ?? null,
    startReason: r.startReason,
    offerPlacement: r.offerPlacement,
    error: null,
  }
}
