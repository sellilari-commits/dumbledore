/**
 * Home → This week: three plain numbers (time studied, questions answered, accuracy) and study
 * minutes per subject as quiet grey bars — no colour, because time is not a status.
 */
import { Section } from '@renderer/design-system'
import { formatMinutes, formatPercent } from '@renderer/lib/format'
import { APP_ROUTES, type HomeData } from '@shared/state'
import { ChartNoAxesColumn } from 'lucide-react'
import { RouteLink } from './RouteLink'

function Stat({ value, label }: { value: string; label: string }) {
  return (
    <div className="hm-stat">
      <div className="hm-stat__value">{value}</div>
      <div className="hm-stat__label">{label}</div>
    </div>
  )
}

export function WeekSection({ week }: { week: HomeData['week'] }) {
  const rows = [...week.minutesBySubject].sort((a, b) => b.minutes - a.minutes)
  const total = rows.reduce((sum, r) => sum + r.minutes, 0)
  const max = Math.max(1, ...rows.map((r) => r.minutes))
  return (
    <Section
      id="home-week"
      title="This week"
      icon={<ChartNoAxesColumn size={14} strokeWidth={1.75} />}
    >
      <div className="hm-stats">
        <Stat value={formatMinutes(total)} label="studied" />
        <Stat value={String(week.questionsAnswered)} label="questions answered" />
        <Stat value={formatPercent(week.accuracy)} label="accuracy" />
      </div>
      {rows.length === 0 ? (
        <p className="hm-quiet">No study time yet this week.</p>
      ) : (
        <ul className="hm-minutes" aria-label="Study time per subject">
          {rows.map((r) => (
            <li key={r.subjectId} className="hm-minutes__row">
              <RouteLink to={APP_ROUTES.subject(r.subjectId)} className="hm-minutes__name">
                <span aria-hidden>{r.emoji}</span>
                <span className="hm-minutes__label">{r.name}</span>
              </RouteLink>
              <span className="hm-minutes__track" aria-hidden>
                <span
                  className="hm-minutes__fill"
                  style={{ width: `${(r.minutes / max) * 100}%` }}
                />
              </span>
              <span className="hm-minutes__value">{formatMinutes(r.minutes)}</span>
            </li>
          ))}
        </ul>
      )}
    </Section>
  )
}
