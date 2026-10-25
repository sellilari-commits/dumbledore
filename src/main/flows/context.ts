/**
 * Context the shell hands to the engine: the ChatContext for prompt writing and a compact text
 * summary (today, subjects and their topics with the ids the coach's tools take, their open
 * roadmaps with steps and progress, focus, due reviews, struggles, session, "right now") for the
 * coach.
 *
 * `chatRoadmapActions` keeps the double-tap chat from planning a second roadmap: a start_roadmap
 * for a subject or topic that already has an open roadmap becomes open_subject (open, continue).
 */
import type {
  ChatContext,
  PerceptionService,
  QueryService,
  Repos,
  StudyService,
} from '@engine/contracts'
import type { CoachAction, Id, Roadmap, RoadmapItem, Subject } from '@shared/domain'
import { topLevel } from '@shared/topics'

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
const ROADMAPS_PER_SUBJECT = 2
/** Roadmaps listed with every step; the rest get one line, so the context stays short. */
const ROADMAPS_WITH_STEPS = 4

type RoadmapRepos = Pick<Repos, 'roadmaps'>

/** A subject's open (not done) roadmaps: the active one first, then the most recently touched. */
export function openRoadmaps(repos: RoadmapRepos, subjectId: Id): Roadmap[] {
  const rank = (r: Roadmap) => (r.status === 'active' ? 0 : 1)
  return repos.roadmaps
    .listBySubject(subjectId)
    .filter((r) => r.status !== 'done')
    .sort((a, b) => rank(a) - rank(b) || b.updatedAt.localeCompare(a.updatedAt))
}

/** "step 3 of 6, 2 done": the current step (else the first not done) and the done count. */
export function roadmapProgress(roadmap: Roadmap): string {
  const { items } = roadmap
  const done = items.filter((i) => i.status === 'done').length
  const at = items.findIndex((i) => i.status === 'current')
  const next = at >= 0 ? at : items.findIndex((i) => i.status === 'todo')
  const step = next >= 0 ? `step ${next + 1} of ${items.length}` : `${items.length} steps`
  return `${step}, ${done} done`
}

const STEP_MARK: Record<RoadmapItem['status'], string> = {
  done: ' (done)',
  current: ' (now)',
  skipped: ' (skipped)',
  todo: '',
}

function roadmapLines(roadmap: Roadmap, withSteps: boolean): string[] {
  const head = `  Roadmap (${roadmap.status}): "${roadmap.title}", ${roadmapProgress(roadmap)}`
  if (!withSteps) return [head]
  return [
    `${head}. Steps:`,
    ...roadmap.items.map((item, i) => `    ${i + 1}. ${item.title}${STEP_MARK[item.status]}`),
  ]
}

/** A few short lines the coach prompt (P10) gets as `context`. */
export function coachContextText(d: CoachContextDeps): string {
  const lines: string[] = []
  const today = d.nowIso().slice(0, 10)
  const weekday = new Date(`${today}T12:00:00Z`).toLocaleDateString('en', { weekday: 'long' })
  lines.push(`Today: ${today} (${weekday})`)
  const focusId = d.repos.settings.get().focusSubjectId
  const subjects = d.queries.subjects().filter((s) => s.status === 'active')
  if (subjects.length > 0) {
    lines.push('Subjects (ids in brackets, for the tools), their topics and open roadmaps:')
    let detailed = 0
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
      const roadmaps = openRoadmaps(d.repos, s.id).slice(0, ROADMAPS_PER_SUBJECT)
      if (!roadmaps.length) lines.push('  No roadmap yet.')
      for (const r of roadmaps) lines.push(...roadmapLines(r, detailed++ < ROADMAPS_WITH_STEPS))
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

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** `name` appears in `text` as whole words (case-insensitive). */
function mentions(text: string, name: string): boolean {
  const n = norm(name)
  if (n.length < 3) return false
  const escaped = n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, 'u').test(norm(text))
}

/**
 * The subject a start_roadmap is about: its id, else a subject it names instead of an id (the
 * model sometimes writes "Statistics"), else the subject whose name or topic the goal names.
 */
function roadmapSubject(
  repos: Pick<Repos, 'subjects' | 'concepts'>,
  action: Extract<CoachAction, { type: 'start_roadmap' }>,
): Subject | null {
  if (action.subjectId) {
    const named =
      repos.subjects.get(action.subjectId) ?? repos.subjects.findByName(action.subjectId)
    if (named) return named
  }
  const subjects = repos.subjects.list({ status: ['active', 'suggested'] })
  return (
    subjects.find((s) => mentions(action.goal, s.name)) ??
    subjects.find((s) =>
      topLevel(repos.concepts.listBySubject(s.id)).some((c) => mentions(action.goal, c.name)),
    ) ??
    null
  )
}

/**
 * Double-tap chat chips: a start_roadmap for a subject that already has an open roadmap becomes
 * open_subject (its page shows the roadmap and Continue), so the chat never plans a second one.
 * Otherwise the subject id is made real (a name becomes its id, an unknown id becomes null so the
 * chip still finds or creates the subject from the goal).
 */
export function chatRoadmapActions(
  repos: Pick<Repos, 'subjects' | 'concepts' | 'roadmaps'>,
  actions: CoachAction[],
): CoachAction[] {
  const out: CoachAction[] = []
  const opened = new Set<Id>()
  const open = (subjectId: Id) => {
    if (!opened.has(subjectId)) out.push({ type: 'open_subject', subjectId })
    opened.add(subjectId)
  }
  for (const action of actions) {
    if (action.type === 'open_subject') {
      open(action.subjectId)
      continue
    }
    if (action.type !== 'start_roadmap') {
      out.push(action)
      continue
    }
    const subject = roadmapSubject(repos, action)
    if (subject && openRoadmaps(repos, subject.id).length > 0) {
      open(subject.id)
      continue
    }
    // A named subject gets its real id; a goal-matched one is left to the start's own resolver.
    out.push({ ...action, subjectId: action.subjectId ? (subject?.id ?? null) : null })
  }
  return out
}
