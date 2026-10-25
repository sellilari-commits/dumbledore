/**
 * Home → Continue: active roadmaps as small cards (subject emoji, roadmap title, subject, a thin
 * bar and "k/n"). The card opens the roadmap; "Resume" picks the study session up again.
 */
import { Button, ProgressBar, Section } from '@renderer/design-system'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { Milestone, Play } from 'lucide-react'
import { useStartRoadmap } from '../study-start'
import { RouteLink } from './RouteLink'

type Item = HomeData['continue'][number]

function ContinueCard({ item }: { item: Item }) {
  const start = useStartRoadmap()
  const total = Math.max(item.total, 1)
  const finished = item.index >= item.total
  const step = Math.min(item.index + 1, item.total)
  // The pop-up says where the step went (in the AI chat, or copied to paste there).
  const resume = () =>
    start.run({ subjectId: item.subjectId, goal: null }, { planning: null, show: false })
  return (
    <li className="hm-card">
      <div className="hm-card__emoji" aria-hidden>
        {item.subjectEmoji}
      </div>
      <RouteLink to={APP_ROUTES.subject(item.subjectId)} className="hm-card__link">
        {item.title}
      </RouteLink>
      <div className="hm-card__subject">{item.subjectName}</div>
      <div className="hm-card__foot">
        <ProgressBar value={item.index / total} label={`${item.title}: steps done`} />
        <span
          className="hm-card__count"
          title={finished ? 'All steps done' : `Step ${step} of ${item.total}`}
        >
          {finished ? 'Done' : `${step}/${item.total}`}
        </span>
      </div>
      {finished ? null : (
        <Button
          className="hm-card__resume"
          size="xs"
          icon={<Play size={12} strokeWidth={2} />}
          loading={start.pending}
          onClick={resume}
          aria-label={`Resume ${item.title}`}
        >
          Resume
        </Button>
      )}
    </li>
  )
}

export function ContinueSection({ items }: { items: HomeData['continue'] }) {
  return (
    <Section id="home-continue" title="Continue" icon={<Milestone size={14} strokeWidth={1.75} />}>
      {items.length === 0 ? (
        <p className="hm-quiet">
          No roadmap in progress. Double-tap right ⌥ and tell Dumbledore what you want to study.
        </p>
      ) : (
        <ul className="hm-cards">
          {items.map((item) => (
            <ContinueCard key={item.roadmapId} item={item} />
          ))}
        </ul>
      )}
    </Section>
  )
}
