/**
 * Failed pastes (StudyService.pasteFailed): a learn step counts as delivered only while the shell
 * hasn't reported that its paste failed. On a failure the step's `promptSent` is cleared, so
 * `next()` doesn't advance past it, and the prompt is kept here, so the next tap pastes the same
 * text again without a new brain call (and without applying the chat's memory updates twice).
 */
import type { Id, Roadmap } from '@shared/domain'
import type { Repos } from '../../contracts'
import { isLearn, withItem } from './roadmap-ops'
import { MOVE_TIPS, type PasteInstruction } from './step-writer'

export class UnpastedSteps {
  /** The last prompt handed out per item (its coach tip isn't stored on the roadmap). */
  private readonly handed = new Map<Id, PasteInstruction>()
  /** Prompts whose paste failed, waiting to be handed out again. */
  private readonly failed = new Map<Id, PasteInstruction>()

  handedOut(instruction: PasteInstruction): void {
    this.handed.clear()
    this.handed.set(instruction.itemId, instruction)
    this.failed.delete(instruction.itemId)
  }

  /** The prompt to hand out again for `itemId`, if its last paste failed. */
  retry(itemId: Id): PasteInstruction | null {
    return this.failed.get(itemId) ?? null
  }

  /**
   * Marks the open learn item `itemId` of `roadmap` as not delivered. Returns the saved roadmap,
   * or null when there is nothing to undo (unknown item, not handed out, or already finished).
   */
  fail(repos: Repos, roadmap: Roadmap, itemId: Id, nowIso: string): Roadmap | null {
    const item = roadmap.items.find((i) => i.id === itemId)
    if (!isLearn(item) || item.promptSent === null) return null
    if (item.status === 'done' || item.status === 'skipped') return null
    const handed = this.handed.get(itemId)
    this.failed.set(
      itemId,
      handed?.text === item.promptSent
        ? handed
        : { kind: 'paste', text: item.promptSent, coachTip: MOVE_TIPS[item.move], itemId },
    )
    const updated = withItem(roadmap, { ...item, promptSent: null }, nowIso)
    repos.roadmaps.save(updated)
    return updated
  }
}
