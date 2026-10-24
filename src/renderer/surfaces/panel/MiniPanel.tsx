/**
 * The mini panel (opens when the orb is clicked): the header with the topic lock, then topic
 * names only; a topic opens its detail (roadmap and flags) in place, with a back chevron. The
 * window fits the content and scrolls past a cap. Everything else (session, goals, chat) lives in
 * the full app, on right ⌥ and on the double-tap chat. Esc goes back, then closes the window.
 */
import { type CSSProperties, useRef, useState } from 'react'
import { PanelHeader } from './header/PanelHeader'
import { closePanel, useEscape } from './panel-actions'
import { TopicDetail } from './TopicDetail'
import { TopicList } from './TopicList'
import { usePanelAutoSize } from './usePanelAutoSize'
import { usePanelTopics } from './usePanelTopics'

export function MiniPanel() {
  const panel = usePanelTopics()
  const card = useRef<HTMLDivElement>(null)
  const cap = usePanelAutoSize(card)
  const [openId, setOpenId] = useState<string | null>(null)
  // A deleted topic closes its detail by itself.
  const open = panel.topics.find((t) => t.id === openId) ?? null
  useEscape(() => (open ? setOpenId(null) : closePanel()))
  return (
    <div
      ref={card}
      className="pn-card"
      data-view="panel"
      style={{ '--pn-cap': `${cap}px` } as CSSProperties}
    >
      <PanelHeader panel={panel} />
      <div className="pn-body" data-pane={open ? 'detail' : 'list'} key={open?.id ?? 'list'}>
        {open ? (
          <TopicDetail topic={open} panel={panel} onBack={() => setOpenId(null)} />
        ) : (
          <TopicList panel={panel} onOpen={(t) => setOpenId(t.id)} />
        )}
      </div>
    </div>
  )
}
