/**
 * Panel header: spectacles glyph + "Dumbledore", the focus picker, the capture switch and ⤢ to
 * open the full app.
 */
import { IconButton, SpectaclesGlyph, Tooltip } from '@renderer/design-system'
import { Maximize2 } from 'lucide-react'
import { openApp } from '../panel-actions'
import { CaptureSwitch } from './CaptureSwitch'
import { FocusMenu } from './FocusMenu'

export function PanelHeader() {
  return (
    <header className="pn-header">
      <div className="pn-brand">
        <SpectaclesGlyph size={20} />
        <span className="pn-brand__name">Dumbledore</span>
      </div>
      <FocusMenu />
      <CaptureSwitch />
      <Tooltip content="Open Dumbledore" shortcut="⌃⌥⌘D">
        <IconButton label="Open Dumbledore" onClick={() => openApp()}>
          <Maximize2 size={15} strokeWidth={1.75} />
        </IconButton>
      </Tooltip>
    </header>
  )
}
