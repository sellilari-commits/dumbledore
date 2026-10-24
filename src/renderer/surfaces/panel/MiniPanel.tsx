/**
 * The mini panel (opens when the orb is clicked): the header with the topic lock, then topic
 * names only. The window fits the list and scrolls past a cap. Everything else (session, goals,
 * chat) lives in the full app, on right ⌥ and on the double-tap chat. Esc closes the window.
 */
import { type CSSProperties, useRef } from 'react'
import { PanelHeader } from './header/PanelHeader'
import { closePanel, useEscape } from './panel-actions'
import { TopicList } from './TopicList'
import { usePanelAutoSize } from './usePanelAutoSize'
import { usePanelTopics } from './usePanelTopics'

export function MiniPanel() {
  const panel = usePanelTopics()
  const card = useRef<HTMLDivElement>(null)
  const cap = usePanelAutoSize(card)
  useEscape(closePanel)
  return (
    <div
      ref={card}
      className="pn-card"
      data-view="panel"
      style={{ '--pn-cap': `${cap}px` } as CSSProperties}
    >
      <PanelHeader panel={panel} />
      <div className="pn-body">
        <TopicList panel={panel} />
      </div>
    </div>
  )
}
