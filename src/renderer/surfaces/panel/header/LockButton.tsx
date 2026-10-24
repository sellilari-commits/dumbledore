/**
 * The one button that decides the current topic: unlocked, the panel follows the topic that most
 * recently got new information; locked, it holds the chosen topic (a filled lock).
 */
import { IconButton, Tooltip } from '@renderer/design-system'
import { Lock, LockOpen } from 'lucide-react'
import type { PanelTopics } from '../usePanelTopics'

export function LockButton({ panel }: { panel: PanelTopics }) {
  const { locked, current } = panel
  const name = current?.name ?? null
  return (
    <Tooltip
      content={locked ? `Locked on ${name}` : 'Lock topic'}
      sub={locked ? 'Click to follow the latest again' : 'Following the newest topic'}
    >
      <span className="pn-lock" data-on={locked || undefined}>
        <IconButton
          label={locked ? 'Unlock topic' : 'Lock topic'}
          aria-pressed={locked}
          disabled={!current}
          onClick={panel.toggleLock}
        >
          {locked ? (
            <Lock size={15} strokeWidth={2} fill="currentColor" fillOpacity={0.18} />
          ) : (
            <LockOpen size={15} strokeWidth={1.75} />
          )}
        </IconButton>
      </span>
    </Tooltip>
  )
}
