/**
 * Memory (/inbox) — what Dumbledore knows: new extractions with their three parts and source,
 * to keep, file under a subject or ignore (inbox.act); suggested subjects (suggested.act);
 * loose notes from casual reading to file or delete (LooseNotes); filters by state and
 * subject; a capture line with today's count. Acted-on rows leave the
 * view at once (optimistic) and come back with an error toast if the call fails.
 */
import {
  Button,
  EmptyState,
  ErrorState,
  LoadingState,
  PageHeader,
  Skeleton,
  toast,
} from '@renderer/design-system'
import { errorToast } from '@renderer/lib/errors'
import { useAction, useAppState, useInbox, useSubjects } from '@renderer/lib/queries'
import type { Encounter, SubjectSummary } from '@shared/domain'
import { Archive, Brain, CheckCheck, EyeOff, Search } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { PageFrame } from '../PageFrame'
import { EncounterRow } from './EncounterRow'
import { InboxFilters } from './InboxFilters'
import {
  type InboxAction,
  isToday,
  type StateFilter,
  type SubjectFilter,
  staysInView,
  UNFILED,
} from './inbox-utils'
import { LooseNotes } from './LooseNotes'
import { SuggestedSubjects } from './SuggestedSubjects'
import './inbox.css'

function CaptureLine({ newItems }: { newItems: Encounter[] | undefined }) {
  const app = useAppState()
  const setCapture = useAction('capture.setEnabled')
  const on = app.data?.capture.enabled ?? false
  const today = (newItems ?? []).filter((e) => isToday(e.createdAt)).length
  if (!app.data) return null
  return (
    <div className="ib-capture">
      <span className="ib-capture__dot" data-on={on} aria-hidden />
      <span>
        {on ? 'Watching your screen' : 'Capture is paused'}
        {newItems ? ` · ${today} new today` : null}
      </span>
      <Button
        size="xs"
        variant="ghost"
        loading={setCapture.isPending}
        onClick={() => setCapture.mutate(!on)}
      >
        {on ? 'Pause' : 'Resume'}
      </Button>
    </div>
  )
}

function ListSkeleton() {
  return (
    <LoadingState caption="Gathering what Dumbledore noticed while you studied…">
      <div className="ib-skeleton" aria-hidden>
        {[0.56, 0.44, 0.62].map((w) => (
          <div key={w} className="ib-skeleton__item">
            <Skeleton width={`${w * 100}%`} height={16} />
            <Skeleton width="34%" height={12} />
            <Skeleton width="92%" />
            <Skeleton width="78%" />
            <Skeleton width={96} height={20} radius={4} />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}

function emptyCopy(
  state: StateFilter,
  filtered: boolean,
): { icon: ReactNode; title: string; body: string } {
  if (filtered)
    return {
      icon: <Search size={28} strokeWidth={1.5} />,
      title: 'Nothing here for this subject',
      body: 'Try another subject or show all subjects.',
    }
  if (state === 'new')
    return {
      icon: <CheckCheck size={28} strokeWidth={1.5} />,
      title: 'You’re all caught up',
      body: 'New things Dumbledore notices while you study land here first, so you decide what it keeps.',
    }
  if (state === 'accepted')
    return {
      icon: <Archive size={28} strokeWidth={1.5} />,
      title: 'Nothing kept yet',
      body: 'Items you keep feed your roadmaps, reviews and exams.',
    }
  if (state === 'ignored')
    return {
      icon: <EyeOff size={28} strokeWidth={1.5} />,
      title: 'Nothing ignored',
      body: 'Ignored items stay out of your roadmaps and reviews.',
    }
  return {
    icon: <Brain size={28} strokeWidth={1.5} />,
    title: 'Nothing captured yet',
    body: 'Study the way you normally do. Dumbledore picks up what you read and asks you here before it files anything.',
  }
}

export function InboxPage() {
  const [state, setState] = useState<StateFilter>('new')
  const [subject, setSubject] = useState<SubjectFilter>(null)
  const [leaving, setLeaving] = useState<ReadonlySet<string>>(new Set())
  const list = useInbox(state === 'all' ? null : state, subject === UNFILED ? null : subject)
  const fresh = useInbox('new')
  const subjects = useSubjects()
  const act = useAction('inbox.act')
  const all: SubjectSummary[] = (subjects.data ?? []).filter((s) => s.status !== 'archived')

  const onAct = (e: Encounter, action: InboxAction, subjectId: string | null) => {
    const target = all.find((s) => s.id === (action === 'assign' ? subjectId : e.subjectId))
    if (!staysInView(e, action, subjectId, { state, subject }))
      setLeaving((prev) => new Set(prev).add(e.id))
    act.mutate(
      { encounterId: e.id, action, subjectId: action === 'assign' ? subjectId : null },
      {
        onSuccess: () =>
          toast(
            action === 'ignore'
              ? 'Ignored — it won’t shape your roadmaps'
              : target
                ? `${action === 'assign' ? 'Filed under' : 'Kept in'} ${target.emoji} ${target.name}`
                : 'Kept',
            { tone: action === 'ignore' ? 'info' : 'success' },
          ),
        onError: (err) => {
          setLeaving((prev) => {
            const next = new Set(prev)
            next.delete(e.id)
            return next
          })
          errorToast(err)
        },
      },
    )
  }

  const rows = (list.data ?? []).filter(
    (e) => !leaving.has(e.id) && (subject !== UNFILED || e.subjectId === null),
  )

  let body: ReactNode
  if (list.isLoading) body = <ListSkeleton />
  else if (list.isError)
    body = (
      <ErrorState
        title="Couldn’t load your memory"
        error={list.error}
        onRetry={() => void list.refetch()}
      />
    )
  else if (rows.length === 0) {
    // No subjects and nothing in view: a first day, so explain capture instead of "caught up".
    const firstDay = subject === null && subjects.data?.length === 0
    const copy = emptyCopy(firstDay || state === 'all' ? 'all' : state, subject !== null)
    body = (
      <EmptyState icon={copy.icon} title={copy.title}>
        {copy.body}
      </EmptyState>
    )
  } else
    body = (
      <div className="ib-list">
        {rows.map((e) => (
          <EncounterRow
            key={e.id}
            encounter={e}
            subjects={all}
            busy={act.isPending && act.variables?.encounterId === e.id}
            onAct={(action, subjectId) => onAct(e, action, subjectId)}
          />
        ))}
      </div>
    )

  return (
    <PageFrame crumbs={[{ label: 'Memory' }]}>
      <PageHeader
        icon={<Brain size={44} strokeWidth={1.5} />}
        title="Memory"
        subtitle="What Dumbledore picked up while you studied. Keep what’s right, file it under a subject, or ignore it."
      >
        <CaptureLine newItems={fresh.data} />
      </PageHeader>
      <SuggestedSubjects subjects={all} />
      <LooseNotes subjects={all} />
      <div className="ib-section">
        <InboxFilters
          state={state}
          subject={subject}
          newCount={fresh.data?.length}
          subjects={all}
          onState={(next) => {
            setLeaving(new Set())
            setState(next)
          }}
          onSubject={(next) => {
            setLeaving(new Set())
            setSubject(next)
          }}
        />
        {body}
      </div>
    </PageFrame>
  )
}
