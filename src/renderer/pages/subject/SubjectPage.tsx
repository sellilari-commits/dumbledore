/**
 * Subject page (/subjects/:id/:view): one simple page, no tabs. Emoji + inline title and
 * description, the goals (goal, deadline), then Progress, Gaps and What Dumbledore caught
 * (the topic tree with its notes, and every capture by day in a toggle).
 * The top bar has "Make a quiz" and a "⋯" menu (Focus, Delete). Every :view opens this page.
 */
import {
  ErrorState,
  LoadingState,
  PageHeader,
  Section,
  Skeleton,
  ToggleBlock,
} from '@renderer/design-system'
import { useSubject, useSubjects } from '@renderer/lib/queries'
import { Eye } from 'lucide-react'
import type { ReactNode } from 'react'
import { Redirect, useParams } from 'wouter'
import { PageFrame } from '../PageFrame'
import { AddMaterial } from './AddMaterial'
import { MemoryTree } from './MemoryTree'
import { SeenView } from './SeenView'
import { GenerateExamButton, SubjectMenu } from './SubjectActions'
import { SubjectHeader } from './SubjectHeader'
import { GapsSection, ProgressSection } from './SubjectSections'
import { isView } from './subject-utils'

const HEAD = { size: 14, strokeWidth: 1.75 } as const

import './subject.css'

/** Header-shaped skeleton; shows the real emoji and name when the sidebar already knows them. */
function SubjectSkeleton({ emoji, name }: { emoji?: string; name?: string }) {
  return (
    <>
      <div aria-hidden>
        <PageHeader
          icon={emoji ?? <Skeleton width={64} height={64} radius={8} />}
          title={name ?? <Skeleton width="48%" height={34} />}
        >
          <div className="sp-skel-props">
            {[180, 132].map((w) => (
              <div key={w} className="sp-skel-prop">
                <Skeleton width={96} height={12} />
                <Skeleton width={w} height={12} />
              </div>
            ))}
          </div>
        </PageHeader>
      </div>
      <LoadingState caption="Loading this subject…" lines={5} className="sp-view" />
    </>
  )
}

export function SubjectPage() {
  const params = useParams<{ id: string; view: string }>()
  const id = params.id ?? ''
  const query = useSubject(id)
  const known = useSubjects().data?.find((s) => s.id === id)

  // Old links name a view (roadmap, concepts, seen, exams); they all open the one page.
  if (!isView(params.view)) return <Redirect to={`/subjects/${id}/roadmap`} replace />
  const detail = query.data

  const crumbs = [
    { label: 'Subjects', muted: true },
    {
      label: detail?.subject.name ?? known?.name ?? 'Subject',
      icon: detail?.subject.emoji ?? known?.emoji,
    },
  ]

  let body: ReactNode
  if (query.isLoading) body = <SubjectSkeleton emoji={known?.emoji} name={known?.name} />
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
  else
    body = (
      <>
        <SubjectHeader key={detail.subject.id} detail={detail} />
        <div className="sp-sections">
          <ProgressSection detail={detail} />
          <GapsSection concepts={detail.concepts} />
          <Section
            id="subject-caught"
            title="What Dumbledore caught"
            icon={<Eye {...HEAD} />}
            actions={<AddMaterial subjectId={detail.subject.id} />}
          >
            <MemoryTree subjectId={detail.subject.id} />
            {detail.encounters.length > 0 ? (
              <ToggleBlock
                title={`Everything it saw, by day (${detail.encounters.length})`}
                className="sp-sources"
              >
                <SeenView encounters={detail.encounters} />
              </ToggleBlock>
            ) : null}
          </Section>
        </div>
      </>
    )

  const actions = detail ? (
    <>
      {detail.subject.status === 'active' ? (
        <GenerateExamButton subjectId={detail.subject.id} />
      ) : null}
      <SubjectMenu subject={detail.subject} />
    </>
  ) : null

  return (
    <PageFrame crumbs={crumbs} actions={actions} width="wide">
      {body}
    </PageFrame>
  )
}
