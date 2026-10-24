/**
 * adjust_roadmap (from the double-tap chat): the student says what a subject's roadmap should
 * cover ("on chemistry I want SN1, not SN2"). P14 maps the words onto the subject's concept tree;
 * the result is merged into the subject's stored study preferences (focus and skip concepts),
 * which the roadmap context turns into the study order: skipped concepts leave it, focus ones
 * (after their prerequisites) lead it. Then the roadmap is planned again from where the student
 * is — finished steps travel along as done steps. Nothing is pasted: the first step of the new
 * roadmap waits for the next right-⌥ tap, like any undelivered step.
 *
 * If the mapping call fails, the student's words are still stored (and shown to P3 as the
 * preference text), so the replan honours them as well as the roadmapper can.
 */
import type { Brain, PreferencesOutput } from '@engine/brain-contract'
import type { PerceptionService, Repos, StudyService } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import { mergePreferences, preferencesInput } from '@engine/learning/study/preferences'
import type { CoachAction } from '@shared/domain'
import type { StepInstruction } from '@shared/state'
import { chatContext } from './context'
import type { Thinking } from './thinking'

export type AdjustRoadmapAction = Extract<CoachAction, { type: 'adjust_roadmap' }>

export interface RoadmapAdjustDeps {
  study: Pick<StudyService, 'start' | 'pasteFailed'>
  repos: Pick<Repos, 'subjects' | 'roadmaps' | 'concepts' | 'profile'>
  brain: Pick<Brain, 'mapPreferences'>
  perception: Pick<PerceptionService, 'aiChat' | 'chatExcerpt' | 'pageContext'>
  thinking: Thinking
  bus: EngineBus
  now?: () => string
}

const NOTHING_MAPPED: PreferencesOutput = {
  replace: false,
  focus: [],
  skip: [],
  focusNames: [],
  skipNames: [],
}

export class RoadmapAdjust {
  constructor(private readonly deps: RoadmapAdjustDeps) {}

  async run(action: AdjustRoadmapAction): Promise<StepInstruction> {
    const { study, repos, brain, thinking, bus } = this.deps
    const subject = repos.subjects.get(action.subjectId)
    if (!subject) throw new Error('That subject no longer exists.')
    const instruction = action.instruction.trim()
    if (!instruction) throw new Error('Say what the roadmap should cover.')

    const goal = repos.roadmaps.getActive(subject.id)?.goal || subject.goal || subject.name
    const step = await thinking.run('Updating your roadmap…', async () => {
      const concepts = repos.concepts.listBySubject(subject.id)
      const current = repos.subjects.studyPreferences(subject.id)
      const mapped = await brain
        .mapPreferences(
          preferencesInput({
            subject: { name: subject.name, goal: subject.goal },
            language: repos.profile.get().promptLanguage,
            concepts,
            current,
            instruction,
          }),
        )
        .catch(() => NOTHING_MAPPED)
      const prefs = mergePreferences({
        current,
        mapped,
        concepts,
        instruction,
        nowIso: this.deps.now?.() ?? new Date().toISOString(),
      })
      repos.subjects.setStudyPreferences(subject.id, prefs)
      bus.emit('memory:changed', { scope: 'subjects', ids: [subject.id] })
      return study.start(
        { subjectId: subject.id, goal, question: null },
        chatContext(this.deps.perception),
      )
    })
    // Planned, not pasted: the next right-⌥ tap delivers the first step.
    if (step.kind === 'paste') study.pasteFailed(step.itemId)
    return step
  }
}
