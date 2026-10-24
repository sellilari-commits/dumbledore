/**
 * createBrain(): the real Brain (src/engine/brain-contract.ts). Wires the backends (Gemini first,
 * then Apple on-device, Groq, OVHcloud, Mistral), the router with its spend cap, the response
 * cache and the prompt modules, and adds the per-method logic around them: extraction chunking for
 * the on-device context, exam batching, verifier batching and the coach stream.
 */
import {
  type Brain,
  type CallOptions,
  CheckpointInput,
  type CoachEvent,
  CoachInput,
  ConsolidateInput,
  type ConsolidateOutput,
  ExamInput,
  ExtractInput,
  type ExtractOutput,
  GapInput,
  type GapOutput,
  ImproveInput,
  NudgeInput,
  type NudgeOutput,
  PreferencesInput,
  type PreferencesOutput,
  ProfileInput,
  type ProfileOutput,
  type PromptWithTip,
  QuestionDraft,
  RoadmapInput,
  type RoadmapPlan,
  StepInput,
  type StepOutput,
  SuggestInput,
  type SuggestOutput,
  TriageInput,
  type TriageOutput,
  type VerifyResult,
} from '@engine/brain-contract'
import type { FeedbackScope, Settings } from '@shared/domain'
import type { LlmTier, ModelRoute, ProviderId, ProviderLimits } from '@shared/llm'
import { z } from 'zod'
import { type Clock, systemClock } from '../clock'
import type { HelperClient, UsageRepo } from '../contracts'
import { runCoach } from './coach'
import { createAppleBackend } from './llm/apple-backend'
import { createMemoryCache, type ResponseCache } from './llm/cache'
import { createCloudBackend } from './llm/cloud-backend'
import { createGeminiBackend } from './llm/gemini-backend'
import { createKeyGetter, type KeyGetter } from './llm/keys'
import { Router } from './llm/router'
import { resolveRoutes } from './llm/routes'
import type { SpendSummary } from './llm/spend'
import { deadlineFor, type RunnerDeps, runStructured } from './llm/structured'
import { clip } from './llm/text'
import type { Backend } from './llm/types'
import { triagePrompt } from './prompts/p00-triage'
import { extractPrompt } from './prompts/p01-extract'
import { roadmapPrompt } from './prompts/p03-roadmap'
import { stepPrompt } from './prompts/p04-step'
import { checkpointPrompt, verifyPrompt } from './prompts/p05-quiz'
import { examBatchPrompt, planExam } from './prompts/p06-exam'
import { gapsPrompt } from './prompts/p07-gaps'
import { improvePrompt } from './prompts/p08-improve'
import { suggestPrompt } from './prompts/p09-suggest'
import { nudgePrompt } from './prompts/p11-nudge'
import { profilePrompt } from './prompts/p12-profile'
import { consolidatePrompt } from './prompts/p13-consolidate'
import { preferencesPrompt } from './prompts/p14-preferences'
import { withFeedback } from './prompts/shared'

export interface BrainDeps {
  clock?: Clock
  /** Every call is logged here (Settings → usage view, daily budgets). */
  usage?: UsageRepo | null
  /** For Apple's on-device model; null/absent = cloud only. */
  helper?: HelperClient | null
  keys?: KeyGetter
  /** Applied to everything sent to a cloud provider (lane L3 supplies the real one). */
  redact?: (text: string) => string
  /** Live settings: model overrides per tier and the on-device switch. */
  settings?: () => Pick<Settings, 'ai'> | null
  /** Replace backends (tests, evals). Missing providers are built from keys/helper. */
  backends?: Partial<Record<ProviderId, Backend>>
  /** Replace route resolution entirely (tests, evals). */
  routes?: (tier: LlmTier) => ModelRoute[]
  cache?: ResponseCache | null
  limits?: Partial<Record<ProviderId, Partial<ProviderLimits>>>
  tierTokensPerDay?: Partial<Record<LlmTier, number>>
  /** Hard cap on paid (Gemini) spend in EUR; default DUMBLEDORE_BUDGET_EUR or 10. */
  spendCapEur?: number
  fetch?: typeof globalThis.fetch
  /**
   * The student's recent feedback for these scopes (newest first), added to the prompts of that
   * kind of work: memory → extraction and consolidation, study_plan → roadmaps, prompts → written
   * prompts, quizzes → checkpoints and exams. 'general' goes everywhere.
   */
  feedback?: (scopes: FeedbackScope[]) => string[]
}

export interface BrainHandle extends Brain {
  readonly router: Router
  /** All-time paid-provider spend (from the usage log) and the cap, EUR. */
  spend(): SpendSummary
}

const EXTRACT_CLOUD_CHARS = 6000
const EXTRACT_DEVICE_CHARS = 4500
const EXTRACT_GROUP_CHARS = 14_000
const VERIFY_BATCH = 10

/** Local date for prompts, e.g. "2026-10-24 (Saturday)". */
export function today(clock: Clock): string {
  const d = new Date(clock.now())
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  return `${iso} (${d.toLocaleDateString('en-US', { weekday: 'long' })})`
}

/** Episodes → call groups: ≤ 3 per call and ≤ ~14K chars for cloud; one per call on-device. */
export function groupEpisodes(input: ExtractInput, onDevice: boolean): ExtractInput[] {
  const maxChars = onDevice ? EXTRACT_DEVICE_CHARS : EXTRACT_CLOUD_CHARS
  const episodes = input.episodes.map((e) => ({ ...e, text: clip(e.text, maxChars) }))
  const groups: (typeof episodes)[] = []
  let current: typeof episodes = []
  let size = 0
  for (const ep of episodes) {
    const full = current.length >= (onDevice ? 1 : 3) || size + ep.text.length > EXTRACT_GROUP_CHARS
    if (current.length && full) {
      groups.push(current)
      current = []
      size = 0
    }
    current.push(ep)
    size += ep.text.length
  }
  if (current.length) groups.push(current)
  return groups.map((episodes) => ({ ...input, episodes }))
}

export function createBrain(deps: BrainDeps = {}): BrainHandle {
  const clock = deps.clock ?? systemClock
  const keys = deps.keys ?? createKeyGetter()
  const backends: Partial<Record<ProviderId, Backend>> = {
    gemini: createGeminiBackend({ keys, fetch: deps.fetch }),
    apple: createAppleBackend({
      helper: deps.helper ?? null,
      clock,
      enabled: () => deps.settings?.()?.ai.useOnDevice ?? true,
    }),
    groq: createCloudBackend('groq', { keys, fetch: deps.fetch }),
    ovh: createCloudBackend('ovh', { keys, fetch: deps.fetch }),
    mistral: createCloudBackend('mistral', { keys, fetch: deps.fetch }),
    ...deps.backends,
  }
  const router = new Router({
    backends,
    clock,
    usage: deps.usage ?? null,
    redact: deps.redact,
    routes: deps.routes ?? ((tier) => resolveRoutes(tier, deps.settings?.()?.ai.modelOverrides)),
    limits: deps.limits,
    tierTokensPerDay: deps.tierTokensPerDay,
    spendCapEur: deps.spendCapEur,
  })
  const runner: RunnerDeps = {
    router,
    cache: deps.cache === undefined ? createMemoryCache(clock) : deps.cache,
    clock,
    today: () => today(clock),
  }

  const feedback = (scope: FeedbackScope): string[] => {
    try {
      return deps.feedback?.([scope, 'general']) ?? []
    } catch {
      return [] // feedback never blocks a call
    }
  }

  /** True when extraction for this language would start on the on-device model. */
  async function onDeviceFirst(language: string): Promise<boolean> {
    if (language === 'fi') return false
    // First route that could serve now: has a backend, is available and (if paid) within budget.
    for (const route of router.routesFor('extract')) {
      const backend = backends[route.provider]
      if (!backend || router.spend.check(route.provider, route.model, 0, 0)) continue
      if (!(await backend.availability()).ok) continue
      return route.provider === 'apple'
    }
    return false
  }

  return {
    router,

    spend: () => router.spend.summary(),

    async triage(raw: TriageInput, opts?: CallOptions): Promise<TriageOutput> {
      const input = TriageInput.parse(raw)
      if (input.episodes.length === 0) return { results: [] }
      return runStructured(runner, triagePrompt, input, opts)
    },

    async extract(raw: ExtractInput, opts?: CallOptions): Promise<ExtractOutput> {
      const input = ExtractInput.parse(raw)
      if (input.episodes.length === 0) return { results: [] }
      const deadline = deadlineFor('extract', clock, opts)
      const onDevice = await onDeviceFirst(extractPrompt.language(input))
      const spec = withFeedback(extractPrompt, feedback('memory'))
      const results: ExtractOutput['results'] = []
      for (const group of groupEpisodes(input, onDevice)) {
        const out = await runStructured(runner, spec, group, { ...opts, deadline })
        results.push(...out.results)
      }
      return { results }
    },

    consolidate: (raw: ConsolidateInput, opts?: CallOptions): Promise<ConsolidateOutput> =>
      runStructured(
        runner,
        withFeedback(consolidatePrompt, feedback('memory')),
        ConsolidateInput.parse(raw),
        opts,
      ),

    mapPreferences: (raw: PreferencesInput, opts?: CallOptions): Promise<PreferencesOutput> =>
      runStructured(runner, preferencesPrompt, PreferencesInput.parse(raw), opts),

    buildRoadmap: (raw: RoadmapInput, opts?: CallOptions): Promise<RoadmapPlan> =>
      runStructured(
        runner,
        withFeedback(roadmapPrompt, feedback('study_plan')),
        RoadmapInput.parse(raw),
        opts,
      ),

    writeStep: (raw: StepInput, opts?: CallOptions): Promise<StepOutput> =>
      runStructured(runner, withFeedback(stepPrompt, feedback('prompts')), StepInput.parse(raw), opts),

    makeCheckpoint: (raw: CheckpointInput, opts?: CallOptions): Promise<QuestionDraft[]> =>
      runStructured(
        runner,
        withFeedback(checkpointPrompt, feedback('quizzes')),
        CheckpointInput.parse(raw),
        opts,
      ),

    async verifyQuestions(raw: QuestionDraft[], opts?: CallOptions): Promise<VerifyResult[]> {
      const questions = z.array(QuestionDraft).parse(raw)
      const deadline = deadlineFor('verifyQuestions', clock, opts)
      const out: VerifyResult[] = []
      for (let start = 0; start < questions.length; start += VERIFY_BATCH) {
        const batch = questions.slice(start, start + VERIFY_BATCH)
        const res = await runStructured(runner, verifyPrompt, batch, { ...opts, deadline })
        out.push(...res.map((r) => ({ ...r, index: r.index + start })))
      }
      return out
    },

    async makeExam(raw: ExamInput, opts?: CallOptions): Promise<QuestionDraft[]> {
      const input = ExamInput.parse(raw)
      const deadline = deadlineFor('makeExam', clock, opts)
      const spec = withFeedback(examBatchPrompt, feedback('quizzes'))
      const questions: QuestionDraft[] = []
      for (const batch of planExam(input)) {
        try {
          const qs = await runStructured(
            runner,
            spec,
            { ...batch, avoid: questions.map((q) => q.stem) },
            { ...opts, deadline },
          )
          questions.push(...qs)
        } catch (err) {
          if (questions.length === 0) throw err
          break // a partial exam beats none; the caller sees the shorter list
        }
      }
      return questions
    },

    async fixGaps(raw: GapInput, opts?: CallOptions): Promise<GapOutput> {
      const input = GapInput.parse(raw)
      if (input.misses.length === 0) return { diagnoses: [], prompt: '', nextTopic: '' }
      return runStructured(runner, gapsPrompt, input, opts)
    },

    improvePrompt: (raw: ImproveInput, opts?: CallOptions): Promise<PromptWithTip> =>
      runStructured(
        runner,
        withFeedback(improvePrompt, feedback('prompts')),
        ImproveInput.parse(raw),
        opts,
      ),

    suggestPrompt: (raw: SuggestInput, opts?: CallOptions): Promise<SuggestOutput> =>
      runStructured(
        runner,
        withFeedback(suggestPrompt, feedback('prompts')),
        SuggestInput.parse(raw),
        opts,
      ),

    coach: (raw: CoachInput, opts?: CallOptions): AsyncIterable<CoachEvent> =>
      runCoach(router, clock, CoachInput.parse(raw), opts),

    writeNudge: (raw: NudgeInput, opts?: CallOptions): Promise<NudgeOutput> =>
      runStructured(runner, nudgePrompt, NudgeInput.parse(raw), opts),

    buildProfile: (raw: ProfileInput, opts?: CallOptions): Promise<ProfileOutput> =>
      runStructured(runner, profilePrompt, ProfileInput.parse(raw), opts),
  }
}
