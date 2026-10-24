/**
 * adjust_roadmap (from the double-tap chat): the student says what a subject's roadmap should
 * cover ("on chemistry I want SN1, not SN2"). The instruction becomes the subject's goal — its
 * study preference — and the roadmap is planned again from it. Nothing is pasted: the first step
 * of the new roadmap waits for the next right-⌥ tap, like any undelivered step.
 *
 * Kept thin on purpose: the structured roadmap (topic tree, prerequisites, focus and skip lists)
 * will take the instruction as constraints instead of folding it into the goal text; this class
 * is the one place that changes.
 */
import type { PerceptionService, Repos, StudyService } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { CoachAction } from '@shared/domain'
import type { StepInstruction } from '@shared/state'
import { chatContext } from './context'
import type { Thinking } from './thinking'

export type AdjustRoadmapAction = Extract<CoachAction, { type: 'adjust_roadmap' }>

export interface RoadmapAdjustDeps {
  study: Pick<StudyService, 'start' | 'pasteFailed'>
  repos: Pick<Repos, 'subjects' | 'roadmaps'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  thinking: Thinking
  bus: EngineBus
}

/** "SN1, not SN2" on top of what the roadmap was for, so the replan keeps the subject's scope. */
export function adjustedGoal(base: string, instruction: string): string {
  const b = base.trim()
  const i = instruction.trim()
  if (!b || b.toLowerCase() === i.toLowerCase()) return i
  return `${b}. Student's wish: ${i}`
}

export class RoadmapAdjust {
  constructor(private readonly deps: RoadmapAdjustDeps) {}

  async run(action: AdjustRoadmapAction): Promise<StepInstruction> {
    const { study, repos, thinking, bus } = this.deps
    const subject = repos.subjects.get(action.subjectId)
    if (!subject) throw new Error('That subject no longer exists.')
    const instruction = action.instruction.trim()
    if (!instruction) throw new Error('Say what the roadmap should cover.')

    const current = repos.roadmaps.getActive(subject.id)
    const base = current?.goal || subject.goal || subject.name
    repos.subjects.update(subject.id, { goal: instruction })
    bus.emit('memory:changed', { scope: 'subjects', ids: [subject.id] })

    const step = await thinking.run('Updating your roadmap…', () =>
      study.start(
        { subjectId: subject.id, goal: adjustedGoal(base, instruction), question: null },
        chatContext(this.deps.perception),
      ),
    )
    // Planned, not pasted: the next right-⌥ tap delivers the first step.
    if (step.kind === 'paste') study.pasteFailed(step.itemId)
    return step
  }
}
