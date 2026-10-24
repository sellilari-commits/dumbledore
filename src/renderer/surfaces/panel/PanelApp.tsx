/**
 * The panel window: providers, hash routes ('/' mini panel · '/picker' study picker), theme
 * sync with settings, and main's 'navigate' events (main re-uses one window for both routes).
 */
import { createQueryClient, Providers } from '@renderer/lib/providers'
import { useSettings } from '@renderer/lib/queries'
import { useThemeSync } from '@renderer/lib/theme'
import { useState } from 'react'
import { Route, Router, Switch } from 'wouter'
import { navigate, useHashLocation } from 'wouter/use-hash-location'
import { MiniPanel } from './MiniPanel'
import { Picker } from './picker/Picker'

const go = (route: string) => navigate(route)

/** The routes without providers or router, so tests can mount them in a memory router. */
export function PanelRoutes() {
  const settings = useSettings()
  useThemeSync(settings.data?.theme)
  return (
    <Switch>
      <Route path="/picker" component={Picker} />
      <Route component={MiniPanel} />
    </Switch>
  )
}

export function PanelApp() {
  const [client] = useState(createQueryClient)
  return (
    <Providers client={client} onNavigate={go}>
      <Router hook={useHashLocation}>
        <PanelRoutes />
      </Router>
    </Providers>
  )
}
