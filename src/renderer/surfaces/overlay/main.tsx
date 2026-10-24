/**
 * Overlay entry (overlay.html): one transparent, full-screen, click-through window per display.
 * Talks to main through `window.dumbledore`, or to the mock driver in a plain browser.
 */
import '@renderer/design-system/tokens.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { displayFromQuery, resolveApi, wantsMock } from './lib/bridge'
import { OverlayApp } from './OverlayApp'

async function boot(): Promise<void> {
  const el = document.getElementById('root')
  if (!el) return
  const api = await resolveApi('overlay')
  const app = <OverlayApp api={api} displayId={displayFromQuery()} />
  if (wantsMock()) {
    const { MockStage } = await import('./mock/MockStage')
    createRoot(el).render(
      <StrictMode>
        <MockStage api={api}>{app}</MockStage>
      </StrictMode>,
    )
    return
  }
  createRoot(el).render(<StrictMode>{app}</StrictMode>)
}

void boot()
