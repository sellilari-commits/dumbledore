/**
 * The few settings the overlay draws with: the theme (light/dark like the other windows) and the
 * Dumbledore key (named in hints). Read once, then again whenever settings change.
 */
import { applyTheme } from '@renderer/lib/theme'
import type { Settings } from '@shared/domain'
import type { DumbledoreApi } from '@shared/ipc'
import { useEffect, useState } from 'react'

export type OverlaySettings = Pick<Settings, 'theme'> & { triggerKey: Settings['shortcut']['key'] }

export function useOverlaySettings(api: DumbledoreApi): OverlaySettings | null {
  const [settings, setSettings] = useState<OverlaySettings | null>(null)

  useEffect(() => {
    let alive = true
    const load = () => {
      api
        .invoke('settings.get')
        .then((s) => {
          if (!alive) return
          applyTheme(s.theme)
          setSettings({ theme: s.theme, triggerKey: s.shortcut.key })
        })
        // The mock driver has no settings: stay on the system theme and the default key.
        .catch(() => undefined)
    }
    load()
    const off = api.on('memory.changed', ({ scope }) => {
      if (scope === 'settings') load()
    })
    return () => {
      alive = false
      off()
    }
  }, [api])

  return settings
}
