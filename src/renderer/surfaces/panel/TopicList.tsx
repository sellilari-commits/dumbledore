/**
 * The panel body: topic names only, newest information first. The current topic is softly
 * marked; a click makes a topic current and locks it. A faint subject name follows a topic only
 * when another subject has one with the same name.
 */
import { SectionError, SectionLoading } from './Section'
import type { PanelTopics } from './usePanelTopics'

export const EMPTY_TOPICS = 'Nothing yet. Read or highlight something and it appears here.'

export function TopicList({ panel }: { panel: PanelTopics }) {
  if (panel.loading) return <SectionLoading lines={3} label="Loading your topics" />
  if (panel.error) return <SectionError error={panel.error} />
  if (panel.topics.length === 0) return <p className="pn-empty">{EMPTY_TOPICS}</p>
  return (
    <ul className="pn-topics" aria-label="Topics">
      {panel.topics.map((t) => {
        const isCurrent = t.id === panel.current?.id
        return (
          <li key={t.id}>
            <button
              type="button"
              className="pn-topic"
              data-current={isCurrent || undefined}
              aria-current={isCurrent || undefined}
              onClick={() => panel.pick(t)}
            >
              <span className="pn-topic__name">{t.name}</span>
              {t.subjectLabel && <span className="pn-topic__subject">{t.subjectLabel}</span>}
            </button>
          </li>
        )
      })}
    </ul>
  )
}
