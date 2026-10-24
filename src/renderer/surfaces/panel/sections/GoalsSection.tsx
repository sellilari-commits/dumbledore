/**
 * Goals & due: the nearest deadlines (assignments and subject goals), reviews that are due with
 * a "Start review" button (coach.runAction start_review), and a Quick exam — five questions on
 * the focus subject (exams.create), opened in the app.
 */
import { Button, cx } from '@renderer/design-system'
import { daysUntil, formatDate } from '@renderer/lib/format'
import { useAction, useHome, useSettings, useSubjects } from '@renderer/lib/queries'
import type { HomeData } from '@shared/state'
import { APP_ROUTES } from '@shared/state'
import { FileCheck2 } from 'lucide-react'
import type { ReactNode } from 'react'
import { openApp, report, useRunAction } from '../panel-actions'
import { Note, Section, SectionError, SectionLoading } from '../Section'

const SHOWN_DEADLINES = 3

type Deadline = HomeData['deadlines'][number]

/** Compact due label: "Today", "Tomorrow", "in 6 days", "Dec 12", "2 days late". */
export function dueLabel(
  iso: string,
  now = Date.now(),
): { text: string; tone: 'late' | 'soon' | null } {
  const days = daysUntil(iso, now)
  if (days < 0) return { text: `${-days} ${days === -1 ? 'day' : 'days'} late`, tone: 'late' }
  if (days === 0) return { text: 'Today', tone: 'soon' }
  if (days === 1) return { text: 'Tomorrow', tone: 'soon' }
  if (days < 14) return { text: `in ${days} days`, tone: days <= 3 ? 'soon' : null }
  return { text: formatDate(iso, now), tone: null }
}

function DeadlineRow({ deadline }: { deadline: Deadline }) {
  const due = dueLabel(deadline.dueAt)
  const subjectId = deadline.subjectId
  return (
    <li>
      <button
        type="button"
        className="pn-row pn-deadline"
        disabled={!subjectId}
        onClick={() => subjectId && openApp(APP_ROUTES.subject(subjectId))}
      >
        <span className="pn-row__icon" aria-hidden>
          {deadline.subjectEmoji ?? '🗓'}
        </span>
        <span className="pn-row__label">{deadline.title}</span>
        <span className={cx('pn-row__aside', due.tone && `pn-due--${due.tone}`)}>{due.text}</span>
      </button>
    </li>
  )
}

function DueReviews({ due }: { due: HomeData['dueReviews'] }) {
  const run = useRunAction()
  const names = due.map((c) => c.conceptName).join(', ')
  return (
    <div className="pn-reviews">
      <span className="pn-row__icon" aria-hidden>
        🔁
      </span>
      <div className="pn-reviews__text">
        <div className="pn-reviews__count">
          {due.length} {due.length === 1 ? 'review' : 'reviews'} due
        </div>
        <div className="pn-reviews__names" title={names}>
          {names}
        </div>
      </div>
      <Button
        size="xs"
        loading={run.isPending}
        onClick={() =>
          run.mutate({ type: 'start_review', conceptIds: due.map((c) => c.conceptId) })
        }
      >
        Start review
      </Button>
    </div>
  )
}

function QuickExam() {
  const settings = useSettings()
  const subjects = useSubjects()
  const create = useAction('exams.create', {
    onSuccess: (quiz) => openApp(APP_ROUTES.exam(quiz.id)),
    onError: report,
  })
  const focusId = settings.data?.focusSubjectId ?? null
  const focus = subjects.data?.find((s) => s.id === focusId && s.status === 'active') ?? null
  return (
    <div className="pn-exam">
      <Button
        size="xs"
        icon={<FileCheck2 size={13} strokeWidth={1.75} />}
        disabled={!focus}
        loading={create.isPending}
        onClick={() =>
          focus &&
          create.mutate({ subjectIds: [focus.id], count: 5, focus: 'weak', difficulty: 'mixed' })
        }
      >
        Quick exam
      </Button>
      <span className="pn-exam__hint">
        {focus
          ? `5 questions on ${focus.emoji} ${focus.name}`
          : subjects.data?.some((s) => s.status === 'active')
            ? 'Pick a focus subject first'
            : 'Add a subject first'}
      </span>
    </div>
  )
}

export function GoalsSection() {
  const home = useHome()
  let body: ReactNode = null
  if (home.isLoading) body = <SectionLoading lines={3} label="Loading deadlines and reviews" />
  else if (!home.data) body = <SectionError error={home.error} />
  else {
    const deadlines = home.data.deadlines.slice(0, SHOWN_DEADLINES)
    const due = home.data.dueReviews
    body = (
      <>
        {deadlines.length > 0 ? (
          <ul className="pn-list">
            {deadlines.map((d) => (
              <DeadlineRow key={d.id} deadline={d} />
            ))}
          </ul>
        ) : null}
        {due.length > 0 ? <DueReviews due={due} /> : null}
        {deadlines.length === 0 && due.length === 0 ? (
          <Note>Nothing due. A good day to get ahead.</Note>
        ) : null}
      </>
    )
  }
  return (
    <Section title="Goals & due">
      {body}
      <QuickExam />
    </Section>
  )
}
