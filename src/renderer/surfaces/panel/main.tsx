/**
 * Entry for panel.html — the mini panel (380×580, anchored to the orb) and the study picker
 * (#/picker). Uses `window.dumbledore` in Electron and the mock API in a plain browser or with
 * ?mock=1; there the card floats on a neutral stage instead of filling its window.
 */
import '@renderer/design-system/tokens.css'
import '@renderer/design-system/base.css'
import './panel.css'
import { isMock } from '@renderer/lib/api'
import { applyTheme } from '@renderer/lib/theme'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { PanelApp } from './PanelApp'

applyTheme('system')
if (isMock()) document.documentElement.dataset.stage = 'browser'

const el = document.getElementById('root')
if (el) {
  createRoot(el).render(
    <StrictMode>
      <PanelApp />
    </StrictMode>,
  )
}
