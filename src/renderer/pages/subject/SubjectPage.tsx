/**
 * Subject page (/subjects/:id/:view, PLAN F7 + the §5.4 wireframe): emoji + inline title,
 * Notion properties, Focus and Generate exam in the top bar, then view tabs — Roadmap ·
 * Concepts · Seen · Exams — with loading (skeleton with specific copy), error and empty states.
 */
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Skeleton,
  type ViewTab,
  ViewTabs,
} from '@renderer/design-system'
import { useSubject, useSubjects } from '@renderer/lib/queries'
import type { SubjectDetail } from '@shared/state'
import { Eye, FilePenLine, Route, Shapes } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Redirect, useLocation, useParams } from 'wouter'
import { PageFrame } from '../PageFrame'
import { ConceptSortMenu, ConceptsView } from './ConceptsView'
import { ExamsView, NewExamButton } from './ExamsView'
import { RoadmapView } from './RoadmapView'
import { SeenView } from './SeenView'
import { FocusToggle, GenerateExamButton } from './SubjectActions'
import { SubjectHeader } from './SubjectHeader'
import { type ConceptSort, DEFAULT_SORT, isView, type SubjectView } from './subject-utils'
import './subject.css'

const TAB_ICON = { size: 14, strokeWidth: 1.75 } as const

const LOADING_COPY: Record<SubjectView, string> = {
  roadmap: 'Loading your roadmap…',
  concepts: 'Loading concepts and review dates…',
  seen: 'Loading what you’ve seen…',
  exams: 'Loading exams…',
}

function tabsFor(d: SubjectDetail): ViewTab<SubjectView>[] {
  return [
    { value: 'roadmap', label: 'Roadmap', icon: <Route {...TAB_ICON} /> },
    {
      value: 'concepts',
      label: 'Concepts',
      icon: <Shapes {...TAB_ICON} />,
      count: d.concepts.length,
    },
    { value: 'seen', label: 'Seen', icon: <Eye {...TAB_ICON} />, count: d.encounters.length },
    { value: 'exams', label: 'Exams', icon: <FilePenLine {...TAB_ICON} />, count: d.exams.length },
  ]
}

/** Header-shaped skeleton; shows the real emoji and name when the sidebar already knows them. */
function SubjectSkeleton({
  view,
  emoji,
  name,
}: {
  view: SubjectView
  emoji?: string
  name?: string
}) {
  return (
    <>
      <div className="sp-header" aria-hidden>
        {emoji ? (
          <div className="dd-page-header__icon">{emoji}</div>
        ) : (
          <Skeleton width={64} height={64} radius={8} className="sp-skel-icon" />
        )}
        <PageHeader title={name ?? <Skeleton width="48%" height={34} />}>
          <div className="sp-skel-props">
            {[132, 180, 112, 220, 96].map((w) => (
              <div key={w} className="sp-skel-prop">
                <Skeleton width={96} height={12} />
                <Skeleton width={w} height={12} />
              </div>
            ))}
          </div>
        </PageHeader>
      </div>
      <div className="sp-skel-tabs" aria-hidden>
        {[72, 84, 52, 60].map((w) => (
          <Skeleton key={w} width={w} height={12} />
        ))}
      </div>
      <LoadingState caption={LOADING_COPY[view]} lines={5} className="sp-view" />
    </>
  )
}

function ViewBody({
  view,
  detail,
  sort,
}: {
  view: SubjectView
  detail: SubjectDetail
  sort: ConceptSort
}) {
  switch (view) {
    case 'roadmap':
      return <RoadmapView detail={detail} />
    case 'concepts':
      return <ConceptsView concepts={detail.concepts} sort={sort} />
    case 'seen':
      return <SeenView encounters={detail.encounters} />
    case 'exams':
      return (
        <ExamsView
          exams={detail.exams}
          subjectId={detail.subject.id}
          subjectName={detail.subject.name}
          canCreate={detail.subject.status === 'active'}
        />
      )
  }
}

export function SubjectPage() {
  const params = useParams<{ id: string; view: string }>()
  const id = params.id ?? ''
  const [, navigate] = useLocation()
  const query = useSubject(id)
  const known = useSubjects().data?.find((s) => s.id === id)
  const [sort, setSort] = useState<ConceptSort>(DEFAULT_SORT)

  if (!isView(params.view)) return <Redirect to={`/subjects/${id}/roadmap`} replace />
  const view = params.view
  const detail = query.data

  const crumbs = [
    { label: 'Subjects', muted: true },
    {
      label: detail?.subject.name ?? known?.name ?? 'Subject',
      icon: detail?.subject.emoji ?? known?.emoji,
    },
  ]

  let body: ReactNode
  if (query.isLoading)
    body = <SubjectSkeleton view={view} emoji={known?.emoji} name={known?.name} />
  else if (query.isError || !detail)
    body = (
      <div className="sp-error">
        <ErrorState
          title="Couldn’t open this subject"
          error={query.error}
          onRetry={() => void query.refetch()}
        />
      </div>
    )
  else {
    const right =
      view === 'concepts' && detail.concepts.length > 1 ? (
        <ConceptSortMenu sort={sort} onChange={setSort} />
      ) : view === 'exams' && detail.exams.length > 0 && detail.subject.status === 'active' ? (
        <NewExamButton subjectId={detail.subject.id} />
      ) : null
    const tabs = tabsFor(detail)
    body = (
      <>
        <SubjectHeader key={detail.subject.id} detail={detail} />
        <ViewTabs
          className="sp-tabs"
          label={`${detail.subject.name} views`}
          tabs={tabs}
          value={view}
          onChange={(v) => navigate(`/subjects/${id}/${v}`)}
          right={right}
        />
        <div
          className="sp-view"
          role="tabpanel"
          aria-label={tabs.find((t) => t.value === view)?.label}
        >
          <ViewBody view={view} detail={detail} sort={sort} />
        </div>
      </>
    )
  }

  const actions = detail ? (
    <>
      <FocusToggle subject={detail.subject} />
      {detail.subject.status === 'active' ? (
        <GenerateExamButton subjectId={detail.subject.id} />
      ) : null}
    </>
  ) : null

  return (
    <PageFrame crumbs={crumbs} actions={actions} width="wide">
      {body}
    </PageFrame>
  )
}
