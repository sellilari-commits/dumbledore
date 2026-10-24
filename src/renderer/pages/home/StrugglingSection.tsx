/**
 * Home → Struggling with: one red callout (Notion's block, the callout is the section) listing
 * concepts that keep not clicking, why Dumbledore thinks so, and "Study this"
 * (coach.runAction start_roadmap on that concept). Hidden when nothing is a struggle.
 */
import { Button, Callout, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { CircleAlert } from 'lucide-react'
import { RouteLink } from './RouteLink'

type Item = HomeData['struggling'][number]

function StruggleRow({ item }: { item: Item }) {
  const run = useAction('coach.runAction')
  const study = () =>
    run.mutate(
      { type: 'start_roadmap', subjectId: item.subjectId, goal: item.conceptName },
      {
        onSuccess: () => toast(`Building a roadmap for ${item.conceptName}…`),
        onError: (err) => errorToast(err),
      },
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
        loading={run.isPending}
        onClick={study}
        aria-label={`Study ${item.conceptName}`}
      >
        Study this
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
