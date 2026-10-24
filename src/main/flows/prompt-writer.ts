/**
 * The study box (right ⌥ hold, ask bar route 'prompt'): "Open a topic". The student
 * types a goal ("SN1 reactions for Friday's exam") and Dumbledore starts it:
 *
 *   1. the subject — an existing one it matches by name, else a new one (StudyService.start
 *      resolves it from the goal text, as a start_roadmap does);
 *   2. the roadmap — planned before anything is written;
 *   3. the first step's prompt — pasted into the AI chat in front, like any study step.
 *
 * With no AI chat open nothing is pasted: the roadmap is still made, its first step waits for the
 * next right-⌥ tap, and the app opens on the new roadmap. A study session already running for
 * the same goal is resumed instead of planned again (StudyService decides).
 */
import type { PerceptionService, StudyService } from '@engine/contracts'
import type { StepInstruction } from '@shared/state'
import { APP_ROUTES } from '@shared/state'
import type { SurfaceControl } from '../platform'
import { chatContext } from './context'
import type { SessionFlow } from './session-flow'
import type { Thinking } from './thinking'

export interface PromptWriterDeps {
  sessions: Pick<SessionFlow, 'start'>
  study: Pick<StudyService, 'start' | 'pasteFailed' | 'current'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  surfaces: Pick<SurfaceControl, 'isOpen' | 'close' | 'open'>
  thinking: Thinking
}

export interface PromptWriteResult {
  /** The first step's prompt is in the AI chat box. */
  pasted: boolean
  /** That prompt ('' when the session went to a quiz or had nothing to paste). */
  prompt: string
}

const promptOf = (step: StepInstruction): string => (step.kind === 'paste' ? step.text : '')

export class PromptWriter {
  constructor(private readonly deps: PromptWriterDeps) {}

  async write(context: string, opts: { signal?: AbortSignal } = {}): Promise<PromptWriteResult> {
    const goal = context.trim()
    if (!goal) throw new Error('Say what you want to study.')
    const input = { subjectId: null, goal, question: null }

    if (this.deps.perception.aiChat()) {
      const result = await this.deps.sessions.start(input, { signal: opts.signal })
      return { pasted: result.write?.ok ?? false, prompt: promptOf(result.instruction) }
    }

    // No AI chat to paste into: plan the roadmap, leave its first step for the next tap.
    const { study, surfaces, thinking } = this.deps
    const step = await thinking.run('Building your roadmap…', () =>
      study.start(input, chatContext(this.deps.perception)),
    )
    if (step.kind === 'paste') study.pasteFailed(step.itemId)
    if (surfaces.isOpen('askbar')) await surfaces.close('askbar')
    const subjectId = study.current()?.subjectId
    if (subjectId) await surfaces.open('app', { route: APP_ROUTES.subject(subjectId, 'roadmap') })
    return { pasted: false, prompt: promptOf(step) }
  }
}
