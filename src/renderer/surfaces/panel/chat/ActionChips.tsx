/** Action chips under a coach reply: each runs its CoachAction through coach.runAction. */
import { Button } from '@renderer/design-system'
import type { CoachAction } from '@shared/domain'
import { useState } from 'react'
import { useRunAction } from '../panel-actions'
import { chipFor } from './actions'

export function ActionChips({ actions }: { actions: CoachAction[] }) {
  const run = useRunAction()
  const [busy, setBusy] = useState<number | null>(null)
  if (actions.length === 0) return null
  return (
    <div className="pn-chips">
      {actions.map((action, i) => {
        const { label, Icon } = chipFor(action)
        return (
          <Button
            // biome-ignore lint/suspicious/noArrayIndexKey: a reply's actions are a fixed list
            key={i}
            size="xs"
            className="pn-chip"
            icon={<Icon size={13} strokeWidth={1.75} aria-hidden />}
            loading={busy === i}
            disabled={busy !== null && busy !== i}
            onClick={() => {
              setBusy(i)
              run.mutate(action, { onSettled: () => setBusy(null) })
            }}
          >
            {label}
          </Button>
        )
      })}
    </div>
  )
}
