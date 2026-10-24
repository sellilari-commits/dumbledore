/**
 * Capture switch: pauses or resumes screen capture (capture.setEnabled), optimistic while it
 * saves. The tooltip names the global shortcut.
 */
import { Switch, Tooltip } from '@renderer/design-system'
import { useAction, useAppState } from '@renderer/lib/queries'
import { report } from '../panel-actions'

export function CaptureSwitch() {
  const state = useAppState()
  const set = useAction('capture.setEnabled', { onError: report })
  const saved = state.data?.capture.enabled ?? true
  const enabled = set.isPending && set.variables !== undefined ? set.variables : saved
  return (
    <Tooltip
      content={enabled ? 'Capture is on' : 'Capture is paused'}
      sub={enabled ? 'Click to pause' : 'Click to resume'}
      shortcut="⌃⌥⌘P"
    >
      <span className="pn-capture" data-on={enabled}>
        <Switch
          checked={enabled}
          onCheckedChange={(on) => set.mutate(on)}
          label={enabled ? 'Pause capture' : 'Resume capture'}
          disabled={!state.data}
        />
      </span>
    </Tooltip>
  )
}
