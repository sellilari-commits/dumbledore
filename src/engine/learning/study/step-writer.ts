/**
 * Step writer wrapper (P4): adapts a learn item's draft to the live chat within 2.5 s, or falls
 * back to the draft itself with a static coach tip for its teaching move (PLAN §6.5 `write`).
 * `deliverLearnStep` also records the prompt as sent and applies the chat's memory updates.
 */
import type { LearnItem, Probe, Roadmap, TeachingMove } from '@shared/domain'
import type { StepInstruction } from '@shared/state'
import type { Brain, MemoryUpdate } from '../../brain-contract'
import type { Clock } from '../../clock'
import { errorMessage, withDeadline } from './deadline'
import type { StudyOptions } from './deps'
import { type MemoryDeps, rememberStep } from './memory-updates'
import { isLearn, recentMisses, withItem } from './roadmap-ops'
import { languageOf, profileText, tail } from './text'

export const MOVE_TIPS: Record<TeachingMove, string> = {
  intuition: 'Asking for an analogy first gives you a hook before the details arrive.',
  definition: 'Asking for a precise definition plus one example pins the idea down.',
  worked_example: 'A worked example shows the steps, not just the answer.',
  contrast: 'Contrasting two look-alike ideas makes the difference stick.',
  apply: 'Applying the idea to a new case tests real understanding, not recall.',
  explain_back: 'Explaining it back in your own words shows what you really know.',
  predict: 'Predicting before reading the answer makes it far more memorable.',
  big_picture: 'Seeing where an idea fits makes the details easier to remember.',
}

export interface StepRequest {
  item: LearnItem
  assistant: string
  language: string
  profile: string
  chatExcerpt: string
  recentMisses: Probe[]
}

export interface WrittenStep {
  prompt: string
  coachTip: string | null
  memoryUpdates: MemoryUpdate[]
  /** True when the brain was slow or failed and the draft was used. */
  fallback: boolean
  error: string | null
}

export async function writeStep(
  brain: Brain,
  clock: Clock,
  req: StepRequest,
  opts: { timeoutMs: number; excerptChars: number },
): Promise<WrittenStep> {
  const { item } = req
  try {
    const out = await withDeadline(clock, opts.timeoutMs, 'writeStep', (call) =>
      brain.writeStep(
        {
          assistant: req.assistant,
          language: req.language,
          profile: req.profile,
          step: {
            title: item.title,
            objective: item.objective,
            move: item.move,
            promptDraft: item.promptDraft,
          },
          chatExcerpt: tail(req.chatExcerpt, opts.excerptChars),
          recentMisses: req.recentMisses,
        },
        call,
      ),
    )
    const prompt = out.prompt.trim()
    if (!prompt) throw new Error('step writer returned an empty prompt')
    return {
      prompt,
      coachTip: out.coachTip.trim() || MOVE_TIPS[item.move],
      memoryUpdates: out.memoryUpdates,
      fallback: false,
      error: null,
    }
  } catch (error) {
    return {
      prompt: item.promptDraft,
      coachTip: MOVE_TIPS[item.move],
      memoryUpdates: [],
      fallback: true,
      error: errorMessage(error),
    }
  }
}

export interface LearnDelivery {
  roadmap: Roadmap
  instruction: StepInstruction
}

/**
 * Writes the prompt for a learn item, stores it as sent on the freshest copy of the roadmap and
 * applies the memory updates. Returns null when the session moved on while the brain was busy.
 */
export async function deliverLearnStep(
  deps: MemoryDeps & { brain: Brain },
  opts: Pick<StudyOptions, 'writeStepTimeoutMs' | 'stepExcerptChars'>,
  req: {
    roadmap: Roadmap
    item: LearnItem
    chatExcerpt: string
    assistant: string
    isCurrent: () => boolean
  },
): Promise<LearnDelivery | null> {
  const { repos, brain, clock } = deps
  const { roadmap, item, assistant } = req
  const profile = repos.profile.get()
  const written = await writeStep(
    brain,
    clock,
    {
      item,
      assistant,
      language: languageOf(profile),
      profile: profileText(profile),
      chatExcerpt: req.chatExcerpt,
      recentMisses: recentMisses(roadmap),
    },
    { timeoutMs: opts.writeStepTimeoutMs, excerptChars: opts.stepExcerptChars },
  )
  if (!req.isCurrent()) return null
  const fresh = repos.roadmaps.get(roadmap.id) ?? roadmap
  const current = fresh.items.find((i) => i.id === item.id)
  const base = isLearn(current) ? current : item
  const updated = withItem(
    fresh,
    { ...base, status: 'current', promptSent: written.prompt },
    clock.nowIso(),
  )
  repos.roadmaps.save(updated)
  rememberStep(deps, updated, item, assistant, written.memoryUpdates)
  return {
    roadmap: updated,
    instruction: {
      kind: 'paste',
      text: written.prompt,
      coachTip: written.coachTip,
      itemId: item.id,
    },
  }
}
