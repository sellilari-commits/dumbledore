/**
 * Home (/home): the greeting and today's line, then Continue, Due for review, Struggling with,
 * Upcoming deadlines, This week and Prompting habits (PLAN F7). Loading shows the page's shape
 * with specific copy. First steps guide a new student (the whole page on a first day, then on
 * top until every step is done).
 */
import { ErrorState, LoadingState, PageHeader, Skeleton } from '@renderer/design-system'
import { greeting } from '@renderer/lib/format'
import { useHome } from '@renderer/lib/queries'
import type { HomeData } from '@shared/state'
import { PageFrame } from '../PageFrame'
import { ContinueSection } from './ContinueSection'
import { DeadlinesSection } from './DeadlinesSection'
import { FirstSteps, useFirstSteps } from './FirstSteps'
import { HabitsSection } from './HabitsSection'
import { isFirstDay, summaryLine, todayLabel } from './home-utils'
import { ReviewSection } from './ReviewSection'
import { StrugglingSection } from './StrugglingSection'
import { WeekSection } from './WeekSection'
import './home.css'

function HomeSkeleton() {
  return (
    <LoadingState caption="Gathering your roadmaps, reviews and deadlines…" className="hm-loading">
      <div className="hm-skeleton" aria-hidden>
        <Skeleton width={120} height={12} />
        <div className="hm-skeleton__cards">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} height={112} radius={6} />
          ))}
        </div>
        <Skeleton width={140} height={12} />
        {['62%', '48%', '55%'].map((w) => (
          <Skeleton key={w} width={w} height={14} />
        ))}
        <Skeleton width={160} height={12} />
        <Skeleton height={64} radius={6} />
      </div>
    </LoadingState>
  )
}

function HomeBody({ home }: { home: HomeData }) {
  const steps = useFirstSteps(home)
  if (isFirstDay(home)) return <FirstSteps steps={steps} welcome />
  return (
    <>
      <FirstSteps steps={steps} />
      <ContinueSection items={home.continue} />
      <ReviewSection items={home.dueReviews} />
      <StrugglingSection items={home.struggling} />
      <DeadlinesSection items={home.deadlines} />
      <WeekSection week={home.week} />
      <HabitsSection habits={home.habits} />
    </>
  )
}

export function HomePage() {
  const home = useHome()
  const hello = greeting()
  const title = home.data?.greetingName ? `${hello}, ${home.data.greetingName}` : hello
  const summary = home.data ? summaryLine(home.data) : null

  return (
    <PageFrame crumbs={[{ label: 'Home' }]}>
      <PageHeader
        compact
        title={title}
        subtitle={
          <>
            {todayLabel()}
            {summary ? <span className="hm-summary"> · {summary}</span> : null}
          </>
        }
      />
      <div className="hm-body">
        {home.isLoading ? (
          <HomeSkeleton />
        ) : home.isError ? (
          <ErrorState
            title="Couldn’t load Home"
            error={home.error}
            onRetry={() => void home.refetch()}
          />
        ) : home.data ? (
          <HomeBody home={home.data} />
        ) : null}
      </div>
    </PageFrame>
  )
}
