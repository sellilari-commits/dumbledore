/**
 * Ranked prompt candidates for an empty chat box (P9, PLAN F3): session next step › the topic
 * locked in the mini panel › an open question from the current page/encounters › struggling
 * concept › due review › deadline › starter. A tap pastes the best one; it never starts a roadmap. Each candidate is a complete student prompt (§7 rules), so the top one works as-is
 * when the brain is unavailable.
 */
import type { Encounter, Profile } from '@shared/domain'
import type { SessionState } from '@shared/state'
import type { SuggestCandidate } from '../../brain-contract'
import type { Repos } from '../../contracts'
import { askedQuestions } from '../../memory/questions'
import { isLearn } from './roadmap-ops'
import { norm, plural } from './text'

const BREVITY =
  'No greetings or small talk. Short structured bullets, max ~150 words, bold key terms.'
const CHECK = 'Then ask me one question to check I got it, and wait.'
const DAY_MS = 86_400_000

export interface CandidateSources {
  repos: Repos
  session: SessionState | null
  pageContext: string
  nowIso: string
}

/** The prompt the running session would paste next, if that is a learn step. */
export function sessionStepPrompt(session: SessionState | null): string | null {
  if (session?.phase !== 'step') return null
  const item = session.items[session.index]
  if (!isLearn(item)) return null
  if (item.promptSent === null) return item.promptDraft
  const next = session.items.find(
    (i) => i.idx > item.idx && (i.status === 'todo' || i.status === 'current'),
  )
  return isLearn(next) ? next.promptDraft : null
}

const context = (subject: string, profile: Profile) =>
  `I'm studying ${subject}${profile.level ? ` (${profile.level})` : ''}.`

export function buildCandidates(src: CandidateSources): SuggestCandidate[] {
  const { repos, nowIso } = src
  const profile = repos.profile.get()
  const subjectName = (id: string | null) => (id ? (repos.subjects.get(id)?.name ?? null) : null)
  const out: SuggestCandidate[] = []

  const step = sessionStepPrompt(src.session)
  if (step) out.push({ kind: 'session_step', text: step })

  const lockedId = repos.settings.get().focusTopicId
  const locked = lockedId ? repos.concepts.get(lockedId) : null
  if (locked) {
    const where =
      locked.status === 'struggling'
        ? `I keep getting ${locked.name} wrong.`
        : `I'm working on ${locked.name}${locked.summary ? ` (${locked.summary})` : ''}.`
    out.push({
      kind: 'focus_topic',
      text: `${context(subjectName(locked.subjectId) ?? locked.name, profile)} ${where} Take me one step further from where I am: 1) the next idea I need, in one sentence, 2) one concrete example, 3) the trap students fall into. ${BREVITY} ${CHECK}`,
    })
  }

  for (const { question, subjectId } of openQuestions(src)) {
    const q = /[?.!]$/.test(question) ? question : `${question}?`
    out.push({
      kind: 'open_question',
      text: `${context(subjectName(subjectId) ?? 'this topic', profile)} ${q} Answer in 3 numbered points with one concrete example. ${BREVITY} ${CHECK}`,
    })
  }

  for (const c of repos.concepts.listStruggling(1)) {
    out.push({
      kind: 'struggling',
      text: `${context(subjectName(c.subjectId) ?? c.name, profile)} I keep getting ${c.name} wrong. 1) Explain the core idea in one sentence. 2) Name the most common misconception and why it's wrong. 3) Walk me through one short example. ${BREVITY} ${CHECK}`,
    })
  }

  for (const c of repos.concepts.listDue(nowIso, 1)) {
    out.push({
      kind: 'due_review',
      text: `${context(subjectName(c.subjectId) ?? c.name, profile)} I studied ${c.name} a while ago and want to check I still know it. Ask me 3 short questions about it, one at a time; wait for each answer and correct me briefly. No greetings or small talk.`,
    })
  }

  const deadline = nextDeadline(repos, nowIso)
  if (deadline) {
    out.push({
      kind: 'deadline',
      text: `${context(deadline.subject, profile)} I have ${deadline.title} on ${deadline.date} (${plural(deadline.days, 'day')} left). Make me a short plan: 1) the 3 most important topics, 2) what to do each day, 3) how to test myself. ${BREVITY}`,
    })
  }

  const starter =
    src.session?.subjectName ||
    subjectName(repos.settings.get().focusSubjectId) ||
    repos.subjects.list({ status: ['active'] }).at(-1)?.name
  out.push({
    kind: 'starter',
    text: starter
      ? `Help me plan how to learn ${starter}. 1) What should I already know first? 2) The 3–5 key ideas in a good order. 3) Ask me one question to find where I'm starting from, and wait. ${BREVITY}`
      : `Help me plan how to learn something new. Ask me what I want to learn and what I already know, then suggest 3–5 steps in order. ${BREVITY}`,
  })
  return out
}

/**
 * Open questions: what the student asked Dumbledore in the last 3 days (newest first), then those
 * of recent encounters, the ones matching the page on screen first.
 */
function openQuestions(src: CandidateSources): { question: string; subjectId: string | null }[] {
  const now = Date.parse(src.nowIso)
  const page = norm(src.pageContext)
  const since = new Date(now - 3 * DAY_MS).toISOString()
  const asked = src.repos.subjects
    .list({ status: ['active'] })
    .flatMap((s) => askedQuestions(src.repos, s.id))
    .filter((n) => n.createdAt >= since)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .map((n) => ({ question: n.text.trim(), subjectId: n.subjectId }))
  const relevance = (e: Encounter) => {
    const terms = [...e.keyTerms, ...e.topicPath].map(norm).filter((t) => t.length >= 3)
    const overlap = page ? terms.filter((t) => page.includes(t)).length : 0
    const hours = Math.max(0, now - Date.parse(e.createdAt)) / 3_600_000
    const sameSubject = src.session && e.subjectId === src.session.subjectId ? 2 : 0
    return overlap * 10 + sameSubject + 0.5 ** (hours / 6)
  }
  const seen = new Set<string>()
  const fromEncounters = src.repos.encounters
    .list({ sinceIso: since, limit: 40 })
    .filter((e) => e.inboxState !== 'ignored' && e.openQuestions.length > 0)
    .map((e) => ({ e, score: relevance(e) }))
    .sort((a, b) => b.score - a.score)
    .flatMap(({ e }) =>
      e.openQuestions.map((question) => ({ question: question.trim(), subjectId: e.subjectId })),
    )
  return [...asked, ...fromEncounters]
    .filter(({ question }) => {
      const key = norm(question)
      if (!key || seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, 2)
}

interface Deadline {
  title: string
  subject: string
  date: string
  days: number
}

/** The nearest deadline in the next two weeks (subject deadlines and open assignments). */
function nextDeadline(repos: Repos, nowIso: string): Deadline | null {
  const now = Date.parse(nowIso)
  const horizon = now + 14 * DAY_MS
  const today = nowIso.slice(0, 10)
  const options: (Deadline & { at: number })[] = []
  for (const s of repos.subjects.list({ status: ['active'] })) {
    if (s.deadline && s.deadline.slice(0, 10) >= today) {
      options.push({
        title: s.goal ?? `my ${s.name} deadline`,
        subject: s.name,
        date: s.deadline.slice(0, 10),
        days: 0,
        at: Date.parse(s.deadline),
      })
    }
  }
  for (const a of repos.assignments.list({ status: 'open' })) {
    if (a.dueAt && a.dueAt.slice(0, 10) >= today) {
      const subject = a.subjectId ? (repos.subjects.get(a.subjectId)?.name ?? a.course) : a.course
      options.push({
        title: a.title,
        subject: subject ?? a.title,
        date: a.dueAt.slice(0, 10),
        days: 0,
        at: Date.parse(a.dueAt),
      })
    }
  }
  const soonest = options.filter((o) => o.at <= horizon).sort((a, b) => a.at - b.at)[0]
  if (!soonest) return null
  return { ...soonest, days: Math.max(0, Math.ceil((soonest.at - now) / DAY_MS)) }
}
