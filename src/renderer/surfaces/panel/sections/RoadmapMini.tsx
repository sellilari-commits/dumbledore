/**
 * The session's roadmap as a mini-list (wireframe §5.4): the last done steps inline (✓), the
 * current step (▸) and the next two (○). Checkpoints carry their question count.
 */
import { cx } from '@renderer/design-system'
import type { RoadmapItem } from '@shared/domain'
import { Play } from 'lucide-react'

const SHOWN_DONE = 2
const SHOWN_NEXT = 2

function Meta({ item }: { item: RoadmapItem }) {
  if (item.kind !== 'checkpoint') return null
  return <span className="pn-rm__meta"> · {item.nQuestions} questions</span>
}

export function RoadmapMini({ items }: { items: RoadmapItem[] }) {
  const done = items.filter((i) => i.status === 'done' || i.status === 'skipped')
  const current = items.find((i) => i.status === 'current') ?? null
  const next = items.filter((i) => i.status === 'todo').slice(0, SHOWN_NEXT)
  const shownDone = done.slice(-SHOWN_DONE)
  const earlier = done.length - shownDone.length

  return (
    <ul className="pn-rm" aria-label="Roadmap">
      {earlier > 0 ? (
        <li className="pn-rm__item pn-rm__item--done pn-rm__item--earlier">+{earlier} done</li>
      ) : null}
      {shownDone.map((item) => (
        <li key={item.id} className="pn-rm__item pn-rm__item--done">
          <span className="pn-rm__mark" aria-hidden>
            ✓
          </span>
          <span className="dd-sr-only">Done: </span>
          {item.title}
        </li>
      ))}
      {current ? (
        <li
          className={cx(
            'pn-rm__item pn-rm__item--current',
            current.kind === 'checkpoint' && 'is-quiz',
          )}
          aria-current="step"
        >
          <span className="pn-rm__mark" aria-hidden>
            <Play size={9} fill="currentColor" strokeWidth={0} />
          </span>
          <span className="dd-sr-only">Current: </span>
          <span className="pn-rm__title">{current.title}</span>
          <Meta item={current} />
        </li>
      ) : null}
      {next.map((item) => (
        <li key={item.id} className="pn-rm__item pn-rm__item--next">
          <span className="pn-rm__mark" aria-hidden>
            ○
          </span>
          <span className="dd-sr-only">Next: </span>
          <span className="pn-rm__title">{item.title}</span>
          <Meta item={item} />
        </li>
      ))}
    </ul>
  )
}
