/**
 * The mini panel (opens when the orb is clicked): the header, then the topics of one subject,
 * the focus subject or else the one that most recently got new information. Everything else
 * (session, goals, chat) lives in the full app, on right ⌥ and on the double-tap chat.
 * Esc closes the window.
 */
import { PanelHeader } from './header/PanelHeader'
import { closePanel, useEscape } from './panel-actions'
import { TopicList } from './TopicList'
import { usePanelSubject } from './usePanelSubject'

export function MiniPanel() {
  const panel = usePanelSubject()
  useEscape(closePanel)
  return (
    <div className="pn-card" data-view="panel">
      <PanelHeader panel={panel} />
      <div className="pn-body">
        <TopicList panel={panel} />
      </div>
    </div>
  )
}
