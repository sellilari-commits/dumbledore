/**
 * Roadmap view: the active roadmap as Notion to-do blocks (RoadmapItem). Steps expand to show
 * their prompt with Copy / Send to chat; checkpoints are callouts with their score and carried
 * ideas. Without a roadmap: an empty state that starts one (coach.runAction start_roadmap).
 */
import { Button, Callout, EmptyState, RoadmapItem, toast } from '@renderer/design-system'
import { formatMinutes } from '@renderer/lib/format'
import { keys, useAction } from '@renderer/lib/queries'
import type { Roadmap } from '@shared/domain'
import type { SubjectDetail } from '@shared/state'
import { useQueryClient } from '@tanstack/react-query'
import { Map as MapIcon } from 'lucide-react'
import { useLocation } from 'wouter'
import { roadmapProgress } from './subject-utils'

function NoRoadmap({ detail }: { detail: SubjectDetail }) {
  const { subject } = detail
  const qc = useQueryClient()
  const start = useAction('coach.runAction')
  const run = () =>
    start.mutate(
      { type: 'start_roadmap', subjectId: subject.id, goal: subject.goal ?? subject.name },
      {
        onSuccess: () => {
          void qc.invalidateQueries({ queryKey: keys.subject(subject.id) })
          toast('Planning your roadmap…')
        },
        onError: (err) => toast(err.message, { tone: 'error' }),
      },
    )
  return (
    <EmptyState
      icon="🗺️"
      title="No roadmap yet — start one in ChatGPT or here"
      actions={
        <Button
          variant="primary"
          icon={<MapIcon size={16} />}
          loading={start.isPending}
          onClick={run}
        >
          Start a roadmap
        </Button>
      }
    >
      Open ChatGPT and tap right ⌥, or start here: Dumbledore plans short steps from what you
      already know, with a quick check after every few.
    </EmptyState>
  )
}

function statusText(r: Roadmap): string {
  const { step, total } = roadmapProgress(r)
  const time = `about ${formatMinutes(r.estimatedMinutes)}`
  if (r.status === 'done') return `Finished · ${total} steps`
  const where = `Step ${Math.min(step, total)} of ${total} · ${time}`
  return r.status === 'paused' ? `Paused · ${where}` : where
}

export function RoadmapView({ detail }: { detail: SubjectDetail }) {
  const roadmap = detail.roadmap
  const copy = useAction('prompt.copy')
  const send = useAction('prompt.sendToChat')
  const [, navigate] = useLocation()

  if (!roadmap) return <NoRoadmap detail={detail} />

  const onCopy = (text: string) =>
    copy.mutate(text, {
      onSuccess: () => toast('Prompt copied', { tone: 'success' }),
      onError: (err) => toast(err.message, { tone: 'error' }),
    })
  const onSend = (text: string) =>
    send.mutate(text, {
      onSuccess: (r) =>
        r.ok
          ? toast('Pasted into your chat — press Enter to send', { tone: 'success' })
          : toast(r.reason ?? 'Couldn’t reach your chat.', {
              tone: 'error',
              action: { label: 'Copy instead', onClick: () => onCopy(text) },
            }),
      onError: (err) => toast(err.message, { tone: 'error' }),
    })

  return (
    <div className="sp-roadmap">
      <div className="sp-roadmap__head">
        <h2 className="sp-roadmap__title">{roadmap.title}</h2>
        <span className="sp-muted">{statusText(roadmap)}</span>
      </div>
      {roadmap.goal ? <p className="sp-roadmap__goal">{roadmap.goal}</p> : null}
      {roadmap.startReason ? (
        <Callout icon="🧭" className="sp-roadmap__why">
          {roadmap.startReason}
        </Callout>
      ) : null}
      <ul className="sp-roadmap__items" aria-label="Roadmap steps">
        {roadmap.items.map((item) => (
          <li key={item.id}>
            <RoadmapItem
              item={item}
              carry={roadmap.carry}
              onCopy={onCopy}
              onSendToChat={onSend}
              onTakeQuiz={
                item.kind === 'checkpoint' && item.quizId
                  ? () => navigate(`/exams/${item.quizId}`)
                  : undefined
              }
            />
          </li>
        ))}
      </ul>
      {roadmap.nextMilestone ? (
        <p className="sp-roadmap__next">
          <span className="sp-muted">Next up after this roadmap:</span> {roadmap.nextMilestone}
        </p>
      ) : null}
    </div>
  )
}
