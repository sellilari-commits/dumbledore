/**
 * Learner profile (P12 profiler, daily): summarises About you, subjects (deadlines, mastery),
 * recurring struggles and prompt habits through Brain.buildProfile into the profile's summary and
 * level. On failure the previous profile stays and the next try waits two hours. The profiler's
 * "habits to coach" feed the prompting tips.
 */
import type { Brain, ProfileInput } from '@engine/brain-contract'
import type { Clock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { Profile } from '@shared/domain'
import { HOUR_MS, type LocalTime, systemLocalTime } from './local-time'

export interface ProfileBuilder {
  /** Rebuilds at most once per local day; resolves true when the profile was updated. */
  maybeBuild(nowMs: number): Promise<boolean>
  build(): Promise<Profile | null>
  habitsToCoach(): string[]
}

export interface ProfileBuilderDeps {
  repos: Repos
  brain: Brain
  bus: EngineBus
  clock: Clock
  localTime?: LocalTime
  log?: (message: string, error?: unknown) => void
}

const RETRY_AFTER_MS = 2 * HOUR_MS
const BUILD_TIMEOUT_MS = 60_000
const MAX_SUMMARY_CHARS = 1600

export function profileInput(repos: Repos): ProfileInput | null {
  const profile = repos.profile.get()
  const subjects = repos.subjects.list({ status: ['active'] })
  if (!profile.aboutMe.trim() && subjects.length === 0) return null
  const subjectLines = subjects.map((s) => {
    const concepts = repos.concepts.listBySubject(s.id)
    const mean = concepts.length
      ? concepts.reduce((sum, c) => sum + c.mastery, 0) / concepts.length
      : 0
    const struggling = concepts.filter((c) => c.status === 'struggling').length
    const deadline = s.deadline ? `, deadline ${s.deadline.slice(0, 10)}` : ''
    const goal = s.goal ? `, goal: ${s.goal}` : ''
    return `- ${s.name}${deadline}${goal}: ${concepts.length} concepts, mastery ${Math.round(mean * 100)}%, ${struggling} struggling`
  })
  const struggles = repos.concepts
    .listStruggling(8)
    .map(
      (c) => `- ${c.name} (struggled ${c.struggleCount}×, mastery ${Math.round(c.mastery * 100)}%)`,
    )
  const h = profile.habits
  return {
    aboutMe: profile.aboutMe.trim() || 'Not given.',
    subjects: subjectLines.join('\n') || 'None yet.',
    struggles: struggles.join('\n') || 'None recorded.',
    habits: `${h.promptsSeen} prompts seen; ${h.withContext} gave context; ${h.withStructure} asked for structure; ${h.askedToBeQuizzed} asked to be quizzed; ${h.askedForExamples} asked for examples.`,
  }
}

export function createProfileBuilder(deps: ProfileBuilderDeps): ProfileBuilder {
  const { repos, brain, bus, clock } = deps
  const lt = deps.localTime ?? systemLocalTime
  const log = deps.log ?? ((m: string, e?: unknown) => console.warn(`[profile] ${m}`, e ?? ''))
  let builtDay: string | null = null
  let lastAttemptAt: number | null = null
  let coach: string[] = []
  let inflight: Promise<Profile | null> | null = null

  async function doBuild(): Promise<Profile | null> {
    const input = profileInput(repos)
    if (!input) return null
    lastAttemptAt = clock.now()
    try {
      const out = await brain.buildProfile(input, { timeoutMs: BUILD_TIMEOUT_MS })
      const summary = out.summary.trim()
      if (!summary) throw new Error('empty profile summary')
      const previous = repos.profile.get()
      const updated = repos.profile.update({
        summary: summary.slice(0, MAX_SUMMARY_CHARS),
        level: out.level?.trim() || previous.level,
      })
      coach = out.habitsToCoach
        .map((h) => h.trim())
        .filter(Boolean)
        .slice(0, 4)
      builtDay = lt.dayKey(clock.now())
      bus.emit('memory:changed', { scope: 'profile', ids: ['profile'] })
      return updated
    } catch (error) {
      log('profile build failed; keeping the previous profile', error)
      return null
    }
  }

  function build(): Promise<Profile | null> {
    inflight ??= doBuild().finally(() => {
      inflight = null
    })
    return inflight
  }

  return {
    build,
    habitsToCoach: () => [...coach],
    async maybeBuild(nowMs) {
      const today = lt.dayKey(nowMs)
      if (builtDay === null) {
        const current = repos.profile.get()
        // A summary written earlier today (before a restart) counts as today's build.
        if (current.summary.trim() && lt.dayKey(Date.parse(current.updatedAt)) === today)
          builtDay = today
      }
      if (builtDay === today) return false
      if (lastAttemptAt !== null && nowMs - lastAttemptAt < RETRY_AFTER_MS) return false
      return (await build()) !== null
    },
  }
}
