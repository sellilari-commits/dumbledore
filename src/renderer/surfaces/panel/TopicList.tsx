/**
 * The panel body: the chosen subject's topics, one calm row each with a small mastery dot.
 * A row opens the subject's concepts in the full app.
 */
import { useSubject } from '@renderer/lib/queries'
import type { SubjectSummary } from '@shared/domain'
import { APP_ROUTES } from '@shared/state'
import { openApp } from './panel-actions'
import { SectionError, SectionLoading } from './Section'
import { STATUS_LABEL, topicsOf } from './topics'
import type { PanelSubject } from './usePanelSubject'

export const EMPTY_TOPICS = 'Nothing yet. Read or highlight something and it appears here.'

function Empty() {
  return <p className="pn-empty">{EMPTY_TOPICS}</p>
}

export function TopicList({ panel }: { panel: PanelSubject }) {
  if (panel.loading) return <SectionLoading lines={3} label="Loading your topics" />
  if (panel.error) return <SectionError error={panel.error} />
  if (!panel.subject) return <Empty />
  return <SubjectTopics subject={panel.subject} />
}

function SubjectTopics({ subject }: { subject: SubjectSummary }) {
  const detail = useSubject(subject.id)
  if (detail.isLoading) return <SectionLoading lines={3} label="Loading your topics" />
  if (!detail.data) return <SectionError error={detail.error} />
  const topics = topicsOf(detail.data.concepts)
  if (topics.length === 0) return <Empty />
  const route = APP_ROUTES.subject(subject.id, 'concepts')
  return (
    <ul className="pn-topics" aria-label={`${subject.name} topics`}>
      {topics.map((c) => (
        <li key={c.id}>
          <button
            type="button"
            className="pn-topic"
            aria-label={`${c.name}, ${STATUS_LABEL[c.status].toLowerCase()}`}
            onClick={() => openApp(route)}
          >
            <span className="pn-topic__name">{c.name}</span>
            <span className="pn-topic__dot" data-status={c.status} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}
