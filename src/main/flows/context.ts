/**
 * Context the shell hands to the engine: the ChatContext for prompt writing and a compact text
 * summary (today, subjects and their topics with the ids the coach's tools take, focus, due
 * reviews, struggles, session, "right now") for the coach.
 */
import type {
  ChatContext,
  PerceptionService,
  QueryService,
  Repos,
  StudyService,
} from '@engine/contracts'

export function chatContext(
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>,
): ChatContext {
  return {
    assistant: perception.aiChat()?.assistant ?? null,
    chatExcerpt: perception.chatExcerpt(1500),
    pageContext: perception.pageContext(1500),
  }
}

export interface CoachContextDeps {
  repos: Repos
  queries: Pick<QueryService, 'subjects'>
  study: Pick<StudyService, 'current'>
  perception: Pick<PerceptionService, 'now' | 'aiChat'>
  nowIso: () => string
}

/** Topics listed per subject in the coach context (gaps first). */
const TOPICS_PER_SUBJECT = 8

/** A few short lines the coach prompt (P10) gets as `context`. */
export function coachContextText(d: CoachContextDeps): string {
  const lines: string[] = []
  const today = d.nowIso().slice(0, 10)
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long' })
  lines.push(`Today: ${today} (${weekday})`)
  const focusId = d.repos.settings.get().focusSubjectId
  const subjects = d.queries.subjects().filter((s) => s.status === 'active')
  if (subjects.length > 0) {
    lines.push('Subjects (ids in brackets, for the tools):')
    for (const s of subjects.slice(0, 8)) {
      const deadline = s.deadline ? `, deadline ${s.deadline.slice(0, 10)}` : ''
      const focus = s.id === focusId ? ' (focus)' : ''
      const goal = d.repos.subjects.get(s.id)?.goal
      lines.push(
        `- ${s.emoji} ${s.name} [${s.id}]${focus}: mastery ${Math.round(s.mastery * 100)}%, ${s.dueReviews} reviews due${deadline}${goal ? `, goal: ${goal}` : ''}`,
      )
      const topics = d.repos.concepts
        .listBySubject(s.id)
        .filter((c) => c.parentId === null)
        .sort((a, b) => Number(b.status === 'struggling') - Number(a.status === 'struggling'))
        .slice(0, TOPICS_PER_SUBJECT)
        .map((c) => `${c.name} [${c.id}]${c.status === 'struggling' ? ' (gap)' : ''}`)
      if (topics.length > 0) lines.push(`  Topics: ${topics.join(', ')}`)
    }
  }
  const struggling = d.repos.concepts.listStruggling(3)
  if (struggling.length > 0)
    lines.push(`Struggling with: ${struggling.map((c) => c.name).join(', ')}`)
  const due = d.repos.concepts.listDue(d.nowIso(), 5)
  if (due.length > 0) lines.push(`Due for review: ${due.map((c) => c.name).join(', ')}`)
  const session = d.study.current()
  if (session) {
    lines.push(
      `Active session: ${session.title} (${session.subjectName}), item ${session.index + 1} of ${session.total}, ${session.phase}`,
    )
  }
  const now = d.perception.now()
  if (now)
    lines.push(`Right now: ${now.app}${now.title ? ` — ${now.title}` : ''} (${now.minutes} min)`)
  const chat = d.perception.aiChat()
  if (chat) lines.push(`An AI chat is open: ${chat.assistant}`)
  return lines.join('\n')
}
