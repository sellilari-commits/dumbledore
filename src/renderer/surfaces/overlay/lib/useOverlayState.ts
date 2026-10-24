/**
 * Live OverlayState: the initial `overlay.getState` plus every 'overlay.changed' push. An event
 * that arrives before the initial fetch resolves wins, because it is newer.
 */
import type { DumbledoreApi } from '@shared/ipc'
import type { OverlayState } from '@shared/state'
import { useEffect, useState } from 'react'
import { report } from './bridge'

export function useOverlayState(api: DumbledoreApi): OverlayState | null {
  const [state, setState] = useState<OverlayState | null>(null)

  useEffect(() => {
    let alive = true
    let pushed = false
    const off = api.on('overlay.changed', (next) => {
      pushed = true
      if (alive) setState(next)
    })
    api
      .invoke('overlay.getState')
      .then((initial) => {
        if (alive && !pushed) setState(initial)
      })
      .catch((error: unknown) => report(error, 'overlay.getState'))
    return () => {
      alive = false
      off()
    }
  }, [api])

  return state
}
