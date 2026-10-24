/**
 * Home → First steps: four things that get Dumbledore going, each ticked off from real data
 * (a subject exists · something was captured · a prompt was written · a quiz was answered).
 * The next open step carries the action. On a first day it is the whole page with a short
 * welcome; later it sits on top of Home until every step is done, then disappears.
 */
import { Button, Kbd, Section } from '@renderer/design-system'
import { useInbox, useSettings, useSubjects } from '@renderer/lib/queries'
import { useShell } from '@renderer/lib/shell'
import type { HomeData } from '@shared/state'
import { Check, ListChecks, Plus } from 'lucide-react'
import type { ReactNode } from 'react'
import { useLocation } from 'wouter'
import { TRIGGER_KEYS } from '../settings/keys'

interface Step {
  id: string
  title: string
  body: ReactNode
  done: boolean
  action?: ReactNode
}

export function useFirstSteps(home: HomeData) {
  const subjects = useSubjects()
  const memory = useInbox(null)
  const settings = useSettings()
  const setNewSubject = useShell((s) => s.setNewSubject)
  const openNewExam = useShell((s) => s.openNewExam)
  const [, navigate] = useLocation()
  const key = TRIGGER_KEYS[settings.data?.shortcut.key ?? 'rightOption'].short

  const steps: Step[] = [
    {
      id: 'subject',
      title: 'Tell Dumbledore what you’re studying',
      body: 'Add a course or topic, with a goal or an exam date if you have one.',
      done: (subjects.data?.length ?? 0) > 0,
      action: (
        <Button
          variant="primary"
          size="sm"
          icon={<Plus size={14} />}
          onClick={() => setNewSubject(true)}
        >
          Add a subject
        </Button>
      ),
    },
    {
      id: 'study',
      title: 'Study the way you normally do',
      body: 'Open your notes, a PDF or an article for a few minutes. Dumbledore reads along and files what you learn in Memory.',
      done: (memory.data?.length ?? 0) > 0 || home.week.minutesBySubject.length > 0,
      action: (
        <Button size="sm" onClick={() => navigate('/inbox')}>
          Open Memory
        </Button>
      ),
    },
    {
      id: 'prompt',
      title: 'Get your first prompt',
      body: (
        <>
          Open ChatGPT, Claude or Gemini and tap <Kbd boxed>{key}</Kbd>. Dumbledore writes a prompt
          that starts from what you already know and pastes it in for you.
        </>
      ),
      done: home.continue.length > 0 || home.habits.promptsSeen > 0,
    },
    {
      id: 'quiz',
      title: 'Check it stuck',
      body: 'Take a two-minute quiz on what you just read. Misses come back in your next review.',
      done: home.week.questionsAnswered > 0,
      action: (
        <Button size="sm" onClick={() => openNewExam()}>
          Make a quiz
        </Button>
      ),
    },
  ]
  return steps
}

export function FirstSteps({ steps, welcome }: { steps: Step[]; welcome?: boolean }) {
  const done = steps.filter((s) => s.done).length
  if (done === steps.length) return null
  const next = steps.find((s) => !s.done)
  return (
    <div className={welcome ? 'hm-start hm-start--welcome' : 'hm-start'}>
      {welcome ? (
        <div className="hm-start__intro">
          <h2 className="hm-start__title">Let’s get started</h2>
          <p className="hm-start__lead">
            Dumbledore learns from how you study. Do these once and this page fills up with what to
            continue, what to review and where you’re stuck.
          </p>
        </div>
      ) : null}
      <Section
        id="home-first-steps"
        title="First steps"
        icon={<ListChecks size={14} strokeWidth={1.75} />}
        actions={
          <span className="hm-section-meta">
            {done} of {steps.length} done
          </span>
        }
      >
        <ol className="hm-steps">
          {steps.map((s, i) => {
            const current = s === next
            return (
              <li
                key={s.id}
                className="hm-step"
                data-state={s.done ? 'done' : current ? 'current' : 'todo'}
              >
                <span className="hm-step__mark" aria-hidden>
                  {s.done ? <Check size={14} strokeWidth={2.25} /> : i + 1}
                </span>
                <div className="hm-step__main">
                  <div className="hm-step__title">
                    {s.title}
                    {s.done ? <span className="dd-sr-only"> (done)</span> : null}
                  </div>
                  {s.done ? null : <div className="hm-step__body">{s.body}</div>}
                  {current && s.action ? <div className="hm-step__action">{s.action}</div> : null}
                </div>
              </li>
            )
          })}
        </ol>
      </Section>
    </div>
  )
}
