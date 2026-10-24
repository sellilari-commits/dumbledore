/**
 * Right now: what Dumbledore thinks you are doing (NowContext: app, page, minutes) and its
 * suggestion with one action. While capture is paused it says so and offers to resume.
 */
import { Button } from '@renderer/design-system'
import { formatMinutes, hostOf } from '@renderer/lib/format'
import { useAction, useAppState, useSession, useSubjects } from '@renderer/lib/queries'
import type { NowContext } from '@shared/state'
import { AppWindow, BookOpen, MessageSquare } from 'lucide-react'
import type { ReactNode } from 'react'
import { suggestionLabel } from '../chat/actions'
import { report, useRunAction } from '../panel-actions'
import { Note, Section, SectionError, SectionLoading } from '../Section'

function NowLine({ now, emoji }: { now: NowContext; emoji: string | null }) {
  const Icon =
    now.kind === 'reading' ? BookOpen : now.kind === 'ai_chat' ? MessageSquare : AppWindow
  const lead = now.kind === 'reading' ? 'Reading' : `In ${now.app}`
  const meta = [
    now.kind === 'reading' ? now.app : null,
    hostOf(now.url),
    formatMinutes(Math.max(1, now.minutes)),
  ]
    .filter(Boolean)
    .join(' · ')
  return (
    <div className="pn-now">
      <span className="pn-now__icon" aria-hidden>
        {emoji ?? <Icon size={15} strokeWidth={1.75} />}
      </span>
      <div className="pn-now__text">
        <div className="pn-now__line">
          {lead}
          {now.title ? <span className="pn-now__title"> “{now.title}”</span> : null}
        </div>
        <div className="pn-now__meta">{meta}</div>
      </div>
    </div>
  )
}

function Suggestion({
  suggestion,
  primary,
}: {
  suggestion: NonNullable<NowContext['suggestion']>
  primary: boolean
}) {
  const run = useRunAction()
  return (
    <div className="pn-suggest">
      <span className="pn-suggest__icon" aria-hidden>
        ✨
      </span>
      <div className="pn-suggest__body">
        <p className="pn-suggest__text">{suggestion.label}</p>
        <Button
          size="sm"
          variant={primary ? 'primary' : 'secondary'}
          loading={run.isPending}
          onClick={() => run.mutate(suggestion.action)}
        >
          {suggestionLabel(suggestion.action)}
        </Button>
      </div>
    </div>
  )
}

export function RightNowSection() {
  const state = useAppState()
  const subjects = useSubjects()
  const session = useSession()
  const resume = useAction('capture.setEnabled', { onError: report })

  let body: ReactNode
  if (state.isLoading) body = <SectionLoading label="Loading what you’re doing" />
  else if (!state.data) body = <SectionError error={state.error} />
  else if (!state.data.capture.enabled)
    body = (
      <div className="pn-paused">
        <Note>Capture is paused — Dumbledore isn’t looking at your screen.</Note>
        <Button size="xs" loading={resume.isPending} onClick={() => resume.mutate(true)}>
          Resume
        </Button>
      </div>
    )
  else if (!state.data.now)
    body = <Note>Nothing to note yet. Keep going — I’ll speak up when it helps.</Note>
  else {
    const now = state.data.now
    const emoji = subjects.data?.find((s) => s.id === now.subjectId)?.emoji ?? null
    // One primary action per surface: a running session (Next) or an open AI chat (Start
    // studying) owns the blue button; otherwise the suggestion does.
    const primary = !session.isLoading && !session.data && !state.data.aiChat
    body = (
      <>
        <NowLine now={now} emoji={emoji} />
        {now.suggestion ? <Suggestion suggestion={now.suggestion} primary={primary} /> : null}
      </>
    )
  }
  return <Section title="Right now">{body}</Section>
}
