/**
 * Entry for app.html — the full Notion-style app window (1200×800, hidden title bar).
 * Uses `window.dumbledore` in Electron, the mock API in a plain browser or with ?mock=1.
 */
import '@renderer/design-system/tokens.css'
import '@renderer/design-system/base.css'
import './app.css'
import { applyTheme } from '@renderer/lib/theme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

applyTheme('system')

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
}
