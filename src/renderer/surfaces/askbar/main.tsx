/**
 * Ask bar entry (askbar.html). In Electron the card fills its small window; in a plain browser
 * (or with `?mock=1`) it floats on a fake desktop and talks to the mock driver.
 */
import '@renderer/design-system/tokens.css'
import '../overlay/styles/ui.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { resolveApi, wantsMock } from '../overlay/lib/bridge'
import { AskBar } from './AskBar'

async function boot(): Promise<void> {
  const el = document.getElementById('root')
  if (!el) return
  const api = await resolveApi('askbar')
  if (wantsMock()) {
    await import('../overlay/mock/mock.css')
    createRoot(el).render(
      <StrictMode>
        <div className="mk-desktop" aria-hidden />
        <div className="ask-stage">
          <AskBar api={api} />
        </div>
      </StrictMode>,
    )
    return
  }
  createRoot(el).render(
    <StrictMode>
      <AskBar api={api} />
    </StrictMode>,
  )
}

void boot()
