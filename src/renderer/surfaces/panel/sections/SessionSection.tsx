/**
 * Session: the active roadmap as a mini-list with one primary button — "▸ Next prompt ⌥" or
 * "Quiz ⌥" (both session.next; main pastes or opens the quiz card). Without a session it offers
 * "Start studying" (→ picker) when an AI chat is open.
 */
import { Button, Spinner } from '@renderer/design-system'
import { useAction, useAppState, useSession } from '@renderer/lib/queries'
import type { SessionState } from '@shared/state'
import { GraduationCap, ListChecks, Play, RotateCcw } from 'lucide-react'
import { report } from '../panel-actions'
import { Note, Section, SectionError, SectionLoading } from '../Section'
import { RoadmapMini } from './RoadmapMini'

function NextButton({ session, retry = false }: { session: SessionState; retry?: boolean }) {
  const next = useAction('session.next', { onError: report })
  const quiz = !retry && session.nextAction === 'open_quiz'
  if (!retry && session.nextAction === 'none') return null
  const label = retry
    ? 'Try again'
    : quiz
      ? 'Quiz'
      : session.nextAction === 'finish'
        ? 'Finish roadmap'
        : 'Next prompt'
  const icon = retry ? (
    <RotateCcw size={13} />
  ) : quiz ? (
    <ListChecks size={14} />
  ) : (
    <Play size={12} fill="currentColor" />
  )
  const where = session.assistant
    ? `Pastes into ${session.assistant}`
    : 'Open an AI chat to paste it'
  return (
    <div className="pn-session__actions">
      <Button
        size="sm"
        variant="primary"
        icon={icon}
        shortcut="⌥"
        loading={next.isPending}
        onClick={() => next.mutate()}
      >
        {label}
      </Button>
      {quiz ? null : <span className="pn-session__hint">{where}</span>}
    </div>
  )
}

function SessionBody({ session }: { session: SessionState }) {
  const start = useAction('session.start', { onError: report })
  switch (session.phase) {
    case 'planning':
      return (
        <div className="pn-session__planning" role="status">
          <Spinner size={12} />
          <span>Building your roadmap…</span>
        </div>
      )
    case 'complete':
      return <Note>✓ Roadmap complete. A follow-up review is scheduled.</Note>
    case 'error':
      return (
        <>
          <p className="pn-note pn-note--error" role="alert">
            {session.error ?? 'The last step didn’t go through.'}
          </p>
          <RoadmapMini items={session.items} />
          <NextButton session={session} retry />
        </>
      )
    case 'paused':
      return (
        <>
          <RoadmapMini items={session.items} />
          <div className="pn-session__actions">
            <Button
              size="sm"
              variant="primary"
              loading={start.isPending}
              onClick={() =>
                start.mutate({ subjectId: session.subjectId, goal: null, question: null })
              }
            >
              Resume
            </Button>
            <span className="pn-session__hint">Paused</span>
          </div>
        </>
      )
    default:
      return (
        <>
          <RoadmapMini items={session.items} />
          <NextButton session={session} />
        </>
      )
  }
}

function NoSession({ onStartStudying }: { onStartStudying: () => void }) {
  const app = useAppState()
  const chat = app.data?.aiChat ?? null
  if (!chat) return <Note>No session running. Open ChatGPT or another AI chat to study.</Note>
  return (
    <div className="pn-start">
      <p className="pn-start__text">{chat.provider} is open — turn it into a study session.</p>
      <Button
        size="sm"
        variant="primary"
        icon={<GraduationCap size={14} />}
        onClick={onStartStudying}
      >
        Start studying
      </Button>
    </div>
  )
}

export function SessionSection({ onStartStudying }: { onStartStudying: () => void }) {
  const query = useSession()
  const session = query.data ?? null
  const step = session ? Math.min(session.index + 1, session.total) : 0
  const title = session ? (
    <>
      Session <span className="pn-section__sep">·</span>{' '}
      <span className="pn-section__emoji">{session.subjectEmoji}</span>
      {session.title}
    </>
  ) : (
    'Session'
  )
  const aside =
    session && session.phase !== 'planning' ? (
      <span>
        <span aria-hidden>
          {step} / {session.total}
        </span>
        <span className="dd-sr-only">
          Step {step} of {session.total}
        </span>
      </span>
    ) : null

  return (
    <Section title={title} aside={aside} className="pn-session">
      {query.isLoading ? (
        <SectionLoading label="Loading your session" />
      ) : query.error ? (
        <SectionError error={query.error} />
      ) : session ? (
        <SessionBody session={session} />
      ) : (
        <NoSession onStartStudying={onStartStudying} />
      )}
    </Section>
  )
}
