/**
 * Memory (/inbox) — what you know. Two views over the same notes:
 * - By topic: each subject's topic tree, notes grouped by the page they came from;
 * - Recent: a timeline by day, one entry per page with where its notes went.
 * Loose notes sit on top when there are any; one search box filters both views. Every note's
 * source links to its page. Nothing here asks the student to approve anything.
 */
import {
  EmptyState,
  ErrorState,
  Input,
  LoadingState,
  PageHeader,
  Skeleton,
  ViewTabs,
} from '@renderer/design-system'
import { useLooseNotes, useSubjectTrees } from '@renderer/lib/memory-queries'
import { useSubjects } from '@renderer/lib/queries'
import type { Note } from '@shared/domain'
import { Brain, Clock3, ListTree, Search } from 'lucide-react'
import { type ReactNode, useMemo, useState } from 'react'
import { PageFrame } from '../PageFrame'
import { SubjectBlock } from './ByTopicView'
import { LooseNotes } from './LooseNotes'
import {
  buildSection,
  filterSection,
  type MemoryView,
  matchesNote,
  recentTimeline,
  type SubjectSection,
} from './memory-model'
import { RecentView } from './RecentView'
import './memory.css'

const VIEWS = [
  { value: 'topics', label: 'By topic', icon: <ListTree size={14} strokeWidth={1.75} /> },
  { value: 'recent', label: 'Recent', icon: <Clock3 size={14} strokeWidth={1.75} /> },
] as const

function PageSkeleton() {
  return (
    <LoadingState caption="Gathering what you know…">
      <div className="mem-skeleton" aria-hidden>
        {[0.4, 0.55, 0.3].map((w) => (
          <div key={w} className="mem-skeleton__item">
            <Skeleton width={`${w * 100}%`} height={16} />
            <Skeleton width="72%" />
            <Skeleton width="58%" />
          </div>
        ))}
      </div>
    </LoadingState>
  )
}

export function InboxPage() {
  const [view, setView] = useState<MemoryView>('topics')
  const [query, setQuery] = useState('')
  const subjects = useSubjects()
  const listed = useMemo(
    () => (subjects.data ?? []).filter((s) => s.status !== 'archived'),
    [subjects.data],
  )
  const trees = useSubjectTrees(listed.map((s) => s.id))
  const loose = useLooseNotes()

  const sections = useMemo(() => {
    const out: SubjectSection[] = []
    listed.forEach((s, i) => {
      const tree = trees.trees[i]
      if (tree) out.push(buildSection(s, tree))
    })
    return out
  }, [listed, trees.trees])

  const searching = query.trim() !== ''
  const looseNotes = (loose.data ?? []).filter((n) => matchesNote(n, query))
  const shownSections = sections
    .map((s) => filterSection(s, query))
    .filter((s): s is SubjectSection => s !== null)

  const recent = useMemo(() => {
    const where = new Map<string, string>()
    const all: Note[] = [...(loose.data ?? [])]
    for (const s of sections) {
      for (const t of s.topics) {
        for (const p of t.pages)
          for (const n of p.notes) {
            all.push(n)
            where.set(n.id, `${s.subject.name} › ${t.concept.name}`)
          }
      }
      for (const p of s.unplaced)
        for (const n of p.notes) {
          all.push(n)
          where.set(n.id, s.subject.name)
        }
    }
    return { all, where }
  }, [sections, loose.data])
  const days = recentTimeline(
    recent.all.filter((n) => matchesNote(n, query)),
    (n) => recent.where.get(n.id) ?? null,
  )

  const loading = subjects.isLoading || trees.isLoading || loose.isLoading
  const error = subjects.error ?? trees.error ?? loose.error
  const nothingAtAll =
    !loading &&
    sections.every((s) => s.topics.length === 0 && s.unplaced.length === 0) &&
    (loose.data ?? []).length === 0

  let body: ReactNode
  if (loading) body = <PageSkeleton />
  else if (error)
    body = (
      <ErrorState
        title="Couldn’t load your memory"
        error={error}
        onRetry={() => {
          void subjects.refetch()
          void trees.refetch()
          void loose.refetch()
        }}
      />
    )
  else if (nothingAtAll)
    body = (
      <EmptyState icon={<Brain size={28} strokeWidth={1.5} />} title="Nothing here yet">
        Read or highlight something and it shows up here.
      </EmptyState>
    )
  else if (searching && shownSections.length === 0 && looseNotes.length === 0)
    body = <p className="mem-quiet mem-quiet--center">Nothing matches “{query.trim()}”.</p>
  else if (view === 'topics')
    body = (
      <>
        <LooseNotes notes={looseNotes} subjects={listed} />
        {shownSections.map((s) => (
          <SubjectBlock key={s.subject.id} section={s} searching={searching} />
        ))}
      </>
    )
  else body = <RecentView days={days} searching={searching} />

  return (
    <PageFrame crumbs={[{ label: 'Memory' }]}>
      <PageHeader
        icon={<Brain size={44} strokeWidth={1.5} />}
        title="Memory"
        subtitle="What you know, by topic. Everything comes from what you read and highlight."
      />
      <div className="mem-toolbar">
        <ViewTabs
          label="Memory view"
          tabs={VIEWS}
          value={view}
          onChange={(v) => setView(v)}
          right={
            <div className="mem-search">
              <Search size={14} strokeWidth={1.75} aria-hidden />
              <Input
                aria-label="Search notes"
                placeholder="Search notes"
                value={query}
                onChange={(e) => setQuery(e.currentTarget.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') setQuery('')
                }}
              />
            </div>
          }
        />
      </div>
      <div className="mem-body">{body}</div>
    </PageFrame>
  )
}
