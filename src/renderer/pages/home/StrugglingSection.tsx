/**
 * Home → Struggling with: one red callout (Notion's block, the callout is the section) listing
 * topics that keep not clicking, why Dumbledore thinks so, and "Make a roadmap": a roadmap of a
 * few steps on that topic (useStartRoadmap: says what happens, then opens the subject page where
 * the roadmap shows). Hidden when nothing is a struggle.
 */
import { Button, Callout } from '@renderer/design-system'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { CircleAlert } from 'lucide-react'
import { ROADMAP_HINT, useStartRoadmap } from '../study-start'
import { RouteLink } from './RouteLink'

type Item = HomeData['struggling'][number]

function StruggleRow({ item }: { item: Item }) {
  const start = useStartRoadmap()
  const study = () =>
    start.run(
      { subjectId: item.subjectId, goal: item.conceptName },
      { planning: `Planning a roadmap for ${item.conceptName}…`, show: true },
    )
  return (
    <li className="hm-struggle__row">
      <span className="hm-struggle__emoji" aria-hidden>
        {item.subjectEmoji}
      </span>
      <div className="hm-struggle__text">
        <RouteLink
          to={APP_ROUTES.subject(item.subjectId, 'concepts')}
          className="hm-struggle__name"
        >
          {item.conceptName}
        </RouteLink>
        <span className="hm-struggle__reason">{item.reason}</span>
      </div>
      <Button
        size="xs"
        variant="ghost"
        className="hm-struggle__action"
        loading={start.pending}
        onClick={study}
        title={ROADMAP_HINT}
        aria-label={`Make a roadmap for ${item.conceptName}`}
      >
        Make a roadmap
      </Button>
    </li>
  )
}

export function StrugglingSection({ items }: { items: HomeData['struggling'] }) {
  if (items.length === 0) return null
  return (
    <section className="hm-struggle-section" aria-labelledby="home-struggling">
      <Callout
        color="red"
        icon={<CircleAlert size={18} strokeWidth={1.75} />}
        className="hm-struggle"
        title={
          <h2 className="hm-struggle__title" id="home-struggling">
            Struggling with
          </h2>
        }
      >
        <ul className="hm-struggle__list">
          {items.map((item) => (
            <StruggleRow key={item.conceptId} item={item} />
          ))}
        </ul>
      </Callout>
    </section>
  )
}
