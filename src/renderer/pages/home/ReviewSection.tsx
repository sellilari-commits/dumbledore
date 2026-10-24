/**
 * Home → Due for review: concepts whose spaced review is due today, and the page's one primary
 * action, "Start 5-min review" (coach.runAction start_review → the review opens as an exam).
 */
import { Button, Section, Tag, toast } from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction } from '@renderer/lib/queries'
import { DUE } from '@renderer/lib/status'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { RotateCcw } from 'lucide-react'
import { useState } from 'react'
import { RouteLink } from './RouteLink'

const SHOWN = 5

export function ReviewSection({ items }: { items: HomeData['dueReviews'] }) {
  const run = useAction('coach.runAction')
  const [all, setAll] = useState(false)
  const shown = all ? items : items.slice(0, SHOWN)
  const hidden = items.length - shown.length

  const start = () =>
    run.mutate(
      { type: 'start_review', conceptIds: items.map((i) => i.conceptId) },
      {
        onSuccess: () => toast('Writing your review — it opens in a moment'),
        onError: (err) => errorToast(err),
      },
    )

  return (
    <Section
      id="home-review"
      title={
        <>
          Due for review
          {items.length > 0 ? (
            <Tag color={DUE.color} className="hm-count">
              {items.length}
            </Tag>
          ) : null}
        </>
      }
      icon={<RotateCcw size={14} strokeWidth={1.75} />}
      actions={
        items.length > 0 ? (
          <Button variant="primary" size="sm" loading={run.isPending} onClick={start}>
            Start 5-min review
          </Button>
        ) : null
      }
    >
      {items.length === 0 ? (
        <p className="hm-quiet">Nothing due — your reviews are up to date.</p>
      ) : (
        <ul className="hm-list">
          {shown.map((c) => (
            <li key={c.conceptId}>
              <RouteLink to={APP_ROUTES.subject(c.subjectId, 'concepts')} className="hm-row">
                <span className="hm-row__emoji" aria-hidden>
                  {c.subjectEmoji}
                </span>
                <span className="hm-row__title">{c.conceptName}</span>
              </RouteLink>
            </li>
          ))}
          {hidden > 0 ? (
            <li>
              <button type="button" className="hm-row hm-row--more" onClick={() => setAll(true)}>
                Show {hidden} more
              </button>
            </li>
          ) : null}
        </ul>
      )}
    </Section>
  )
}
