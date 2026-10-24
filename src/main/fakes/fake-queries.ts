/**
 * Fake QueryService (lane L2a builds the real one): read models computed straight from `Repos`.
 * Good enough for the demo and the shell's tests; numbers are simple, not tuned.
 */
import type { Clock } from '@engine/clock'
import type { QueryService, Repos } from '@engine/contracts'
import type { Encounter, Id, InboxState, Quiz, Subject, SubjectSummary } from '@shared/domain'
import { DEFAULT_ROUTES, PROVIDER_LIMITS } from '@shared/llm'
import type {
  HomeData,
  PickerData,
  QuizSummary,
  SearchHit,
  SubjectDetail,
  UsageSummary,
} from '@shared/state'

const DAY = 86_400_000

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

export class FakeQueryService implements QueryService {
  constructor(
    private readonly repos: Repos,
    private readonly clock: Clock,
  ) {}

  summarize(subject: Subject): SubjectSummary {
    const { repos } = this
    const nowIso = this.clock.nowIso()
    const concepts = repos.concepts.listBySubject(subject.id)
    const roadmap = repos.roadmaps.getActive(subject.id)
    const done = roadmap?.items.filter((i) => i.status === 'done').length ?? 0
    const weekAgo = new Date(this.clock.now() - 7 * DAY).toISOString()
    const encounters = repos.encounters.list({ subjectId: subject.id })
    const week = encounters.filter((e) => e.createdAt >= weekAgo)
    return {
      ...subject,
      progress: roadmap && roadmap.items.length > 0 ? done / roadmap.items.length : 0,
      mastery:
        concepts.length > 0 ? concepts.reduce((n, c) => n + c.mastery, 0) / concepts.length : 0,
      dueReviews: concepts.filter((c) => c.nextReviewAt !== null && c.nextReviewAt <= nowIso)
        .length,
      openQuestions: repos.encounters.openQuestions(subject.id, 50).length,
      studyMinutesWeek: Math.round(week.reduce((n, e) => n + e.dwellSeconds, 0) / 60),
      lastStudiedAt: encounters[0]?.createdAt ?? null,
    }
  }

  home(): HomeData {
    const { repos } = this
    const nowIso = this.clock.nowIso()
    const subjects = repos.subjects.list({ status: ['active'] })
    const byId = new Map(subjects.map((s) => [s.id, s]))
    const emoji = (id: Id | null) => (id ? (byId.get(id)?.emoji ?? '📘') : null)
    const weekAgo = new Date(this.clock.now() - 7 * DAY).toISOString()
    const answers = repos.quizzes
      .list({})
      .flatMap((q) => q.answers)
      .filter((a) => a.answeredAt >= weekAgo)
    const conceptName = (id: Id) => repos.concepts.get(id)?.name ?? 'Concept'
    return {
      greetingName: repos.profile.get().aboutMe.match(/^I'm (\w+)/)?.[1] ?? 'there',
      continue: repos.roadmaps.listActive().map((r) => ({
        roadmapId: r.id,
        subjectId: r.subjectId,
        subjectName: byId.get(r.subjectId)?.name ?? 'Subject',
        subjectEmoji: emoji(r.subjectId) ?? '📘',
        title: r.title,
        index: r.items.filter((i) => i.status === 'done').length,
        total: r.items.length,
      })),
      dueReviews: repos.concepts.listDue(nowIso, 10).map((c) => ({
        conceptId: c.id,
        conceptName: c.name,
        subjectId: c.subjectId,
        subjectEmoji: emoji(c.subjectId) ?? '📘',
      })),
      struggling: repos.concepts.listStruggling(5).map((c) => ({
        conceptId: c.id,
        conceptName: conceptName(c.id),
        subjectId: c.subjectId,
        subjectEmoji: emoji(c.subjectId) ?? '📘',
        reason: `Missed ${c.struggleCount} time${c.struggleCount === 1 ? '' : 's'} recently`,
      })),
      deadlines: [
        ...repos.assignments
          .list({ status: 'open' })
          .filter((a) => a.dueAt !== null)
          .map((a) => ({
            id: a.id,
            title: a.title,
            dueAt: a.dueAt ?? nowIso,
            kind: 'assignment' as const,
            subjectId: a.subjectId,
            subjectEmoji: emoji(a.subjectId),
          })),
        ...subjects
          .filter((s) => s.deadline !== null)
          .map((s) => ({
            id: s.id,
            title: s.goal ?? s.name,
            dueAt: s.deadline ?? nowIso,
            kind: 'subject' as const,
            subjectId: s.id,
            subjectEmoji: s.emoji,
          })),
      ].sort((a, b) => a.dueAt.localeCompare(b.dueAt)),
      week: {
        minutesBySubject: subjects.map((s) => ({
          subjectId: s.id,
          name: s.name,
          emoji: s.emoji,
          minutes: this.summarize(s).studyMinutesWeek,
        })),
        questionsAnswered: answers.length,
        accuracy:
          answers.length > 0 ? answers.filter((a) => a.correct).length / answers.length : null,
      },
      habits: repos.profile.get().habits,
    }
  }

  subjects(): SubjectSummary[] {
    return this.repos.subjects
      .list({ status: ['active', 'suggested'] })
      .map((s) => this.summarize(s))
  }

  subject(id: Id): SubjectDetail {
    const subject = this.repos.subjects.get(id)
    if (!subject) throw new Error(`Subject ${id} not found`)
    return {
      subject: this.summarize(subject),
      roadmap:
        this.repos.roadmaps.getActive(id) ?? this.repos.roadmaps.listBySubject(id)[0] ?? null,
      concepts: this.repos.concepts.listBySubject(id),
      encounters: this.repos.encounters.list({ subjectId: id, limit: 100 }),
      exams: this.repos.quizzes.list({ subjectId: id }).map(quizSummary),
      assignments: this.repos.assignments.list({ subjectId: id }),
    }
  }

  inbox(filter: { state: InboxState | null; subjectId: Id | null }): Encounter[] {
    return this.repos.encounters.list({
      inboxState: filter.state,
      subjectId: filter.subjectId,
      limit: 200,
    })
  }

  exams(): QuizSummary[] {
    return this.repos.quizzes.list({ kind: 'exam' }).map(quizSummary)
  }

  search(q: string): SearchHit[] {
    return this.repos.search.query(q, 20)
  }

  usage(): UsageSummary {
    const since = new Date(this.clock.now() - DAY).toISOString()
    const seen = new Set<string>()
    const limits: UsageSummary['limits'] = []
    for (const route of Object.values(DEFAULT_ROUTES).flat()) {
      const key = `${route.provider}|${route.model}`
      if (seen.has(key)) continue
      seen.add(key)
      const l = PROVIDER_LIMITS[route.provider]
      limits.push({
        provider: route.provider,
        model: route.model,
        requestsPerDay: l.requestsPerDay,
        tokensPerDay: l.tokensPerDay,
      })
    }
    return { rows: this.repos.usage.rowsSince(since), limits }
  }

  picker(): PickerData {
    const focusId = this.repos.settings.get().focusSubjectId
    const rank = (s: SubjectSummary) =>
      (s.id === focusId ? 100 : 0) + s.dueReviews * 3 + s.openQuestions + (s.progress > 0 ? 2 : 0)
    return {
      subjects: this.repos.subjects
        .list({ status: ['active'] })
        .map((s) => this.summarize(s))
        .sort((a, b) => rank(b) - rank(a))
        .map((subject) => ({
          subject,
          questions: this.repos.encounters.openQuestions(subject.id, 3),
          hasActiveRoadmap: this.repos.roadmaps.getActive(subject.id) !== null,
        })),
    }
  }
}
