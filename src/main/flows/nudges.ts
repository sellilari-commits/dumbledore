/**
 * What happens to a nudge after it is shown: accept runs its action, dismiss/snooze record the
 * outcome, and an ignored nudge that leaves the orb's orange dot after an hour is 'expired'.
 */
import type { Clock } from '@engine/clock'
import type { Repos } from '@engine/contracts'
import type { EngineBus } from '@engine/events'
import type { CoachAction, Id, Nudge } from '@shared/domain'

export interface NudgeActionsDeps {
  repos: Repos
  clock: Clock
  bus: EngineBus
  runAction: (action: CoachAction) => Promise<void>
  clearFromOverlay: (nudgeId: Id) => void
}

const EPOCH = '1970-01-01T00:00:00.000Z'

export class NudgeActions {
  constructor(private readonly deps: NudgeActionsDeps) {}

  shown(nudge: Nudge): void {
    this.update(nudge.id, { shownAt: this.deps.clock.nowIso() })
  }

  async act(nudgeId: Id, choice: 'accept' | 'dismiss' | 'snooze'): Promise<void> {
    this.deps.clearFromOverlay(nudgeId)
    const nudge = this.find(nudgeId)
    if (!nudge) return
    const outcome = choice === 'accept' ? 'accepted' : choice === 'snooze' ? 'snoozed' : 'dismissed'
    this.update(nudgeId, { outcome })
    if (choice === 'accept' && nudge.action) await this.deps.runAction(nudge.action)
  }

  expired(nudgeId: Id): void {
    if (this.find(nudgeId)?.outcome === 'pending') this.update(nudgeId, { outcome: 'expired' })
  }

  private find(nudgeId: Id): Nudge | null {
    return this.deps.repos.nudges.listSince(EPOCH).find((n) => n.id === nudgeId) ?? null
  }

  private update(nudgeId: Id, patch: Partial<Pick<Nudge, 'shownAt' | 'outcome'>>): void {
    try {
      this.deps.repos.nudges.update(nudgeId, patch)
      this.deps.bus.emit('memory:changed', { scope: 'nudges', ids: [nudgeId] })
    } catch {
      // unknown nudge (e.g. from an engine toast): nothing to record
    }
  }
}
