/**
 * The mini panel (PLAN §5.2, wireframe §5.4): header, then Right now · Session · Goals & due ·
 * Subjects · Chat in one scrolling column, with the chat input pinned to the bottom.
 * Esc closes the window (the chat input clears typed text first).
 */
import { useLocation } from 'wouter'
import { ChatComposer } from './chat/ChatComposer'
import { ChatThread } from './chat/ChatThread'
import { usePanelChat } from './chat/usePanelChat'
import { PanelHeader } from './header/PanelHeader'
import { closePanel, useEscape } from './panel-actions'
import { GoalsSection } from './sections/GoalsSection'
import { RightNowSection } from './sections/RightNowSection'
import { SessionSection } from './sections/SessionSection'
import { SubjectsSection } from './sections/SubjectsSection'

export const PANEL_THREAD = 'panel'

export function MiniPanel() {
  const chat = usePanelChat(PANEL_THREAD)
  const [, navigate] = useLocation()
  useEscape(closePanel)
  return (
    <div className="pn-card" data-view="panel">
      <PanelHeader />
      <div className="pn-body">
        <RightNowSection />
        <SessionSection onStartStudying={() => navigate('/picker')} />
        <GoalsSection />
        <SubjectsSection />
        <ChatThread chat={chat} />
      </div>
      <ChatComposer chat={chat} />
    </div>
  )
}
