/** The Home page read model (PLAN §5.3 F7): continue, due, struggling, deadlines, this week. */
import type { Concept, Encounter, Quiz, Subject } from '@shared/domain'
import type { HomeData } from '@shared/state'
import type { Repos } from '../contracts'
import { struggleReason } from './struggle'
import { currentItemIndex, studyMinutes } from './summary'
import { DAY_MS, dueTime, iso } from './time'

export interface HomeOptions {
  nowMs: number
  greetingName: string
  /** Local midnight of the day containing a time. */
  startOfDay: (ms: number) => number
}

export function buildHome(repos: Repos, opts: HomeOptions): HomeData {
  const { nowMs } = opts
  const nowIso = iso(nowMs)
  const active = new Map<string, Subject>(
    repos.subjects.list({ status: ['active'] }).map((s) => [s.id, s]),
  )
  const emojiOf = (subjectId: string | null) =>
    (subjectId ? active.get(subjectId)?.emoji : undefined) ?? null

  const roadmaps = repos.roadmaps.listActive().filter((r) => active.has(r.subjectId))
  const due = repos.concepts.listDue(nowIso, 50).filter((c) => active.has(c.subjectId))
  const struggling = repos.concepts.listStruggling(10).filter((c) => active.has(c.subjectId))
  const histories = new Map<string, { quizzes: Quiz[]; encounters: Encounter[] }>()
  const reasonFor = (c: Concept): string => {
    let h = histories.get(c.subjectId)
    if (!h) {
      h = {
        quizzes: repos.quizzes.list({ subjectId: c.subjectId, limit: 20 }),
        encounters: repos.encounters.list({ subjectId: c.subjectId, limit: 200 }),
      }
      histories.set(c.subjectId, h)
    }
    return struggleReason(c, h.quizzes, h.encounters)
  }

  const today = opts.startOfDay(nowMs)
  const upcoming = (dueAt: string | null): dueAt is string =>
    dueAt !== null && dueTime(dueAt) >= today
  const deadlines: HomeData['deadlines'] = [
    ...repos.assignments
      .list({ status: 'open' })
      .filter((a) => upcoming(a.dueAt))
      .filter((a) => a.subjectId === null || active.has(a.subjectId))
      .map((a) => ({
        id: a.id,
        title: a.title,
        dueAt: a.dueAt ?? '',
        kind: 'assignment' as const,
        subjectId: a.subjectId,
        subjectEmoji: emojiOf(a.subjectId),
      })),
    ...[...active.values()]
      .filter((s) => upcoming(s.deadline))
      .map((s) => ({
        id: s.id,
        title: s.goal ? `${s.name} · ${s.goal}` : s.name,
        dueAt: s.deadline ?? '',
        kind: 'subject' as const,
        subjectId: s.id,
        subjectEmoji: s.emoji,
      })),
  ]
    .sort((a, b) => dueTime(a.dueAt) - dueTime(b.dueAt))
    .slice(0, 10)

  const weekSince = iso(nowMs - 7 * DAY_MS)
  const minutesBySubject = [...active.values()]
    .map((s) => ({
      subjectId: s.id,
      name: s.name,
      emoji: s.emoji,
      minutes: studyMinutes(repos.encounters.list({ subjectId: s.id, sinceIso: weekSince })),
    }))
    .filter((m) => m.minutes > 0)
    .sort((a, b) => b.minutes - a.minutes)
  const answers = repos.quizzes
    .list({ limit: 100 })
    .flatMap((q) => q.answers)
    .filter((a) => a.answeredAt >= weekSince)

  return {
    greetingName: opts.greetingName,
    continue: roadmaps.map((r) => ({
      roadmapId: r.id,
      subjectId: r.subjectId,
      subjectName: active.get(r.subjectId)?.name ?? '',
      subjectEmoji: active.get(r.subjectId)?.emoji ?? '',
      title: r.title,
      index: currentItemIndex(r),
      total: r.items.length,
    })),
    dueReviews: due.map((c) => ({
      conceptId: c.id,
      conceptName: c.name,
      subjectId: c.subjectId,
      subjectEmoji: emojiOf(c.subjectId) ?? '',
    })),
    struggling: struggling.map((c) => ({
      conceptId: c.id,
      conceptName: c.name,
      subjectId: c.subjectId,
      subjectEmoji: emojiOf(c.subjectId) ?? '',
      reason: reasonFor(c),
    })),
    deadlines,
    week: {
      minutesBySubject,
      questionsAnswered: answers.length,
      accuracy: answers.length ? answers.filter((a) => a.correct).length / answers.length : null,
    },
    habits: repos.profile.get().habits,
  }
}
