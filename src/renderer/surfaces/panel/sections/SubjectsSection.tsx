/**
 * Subjects: each active subject with its emoji, name and a thin progress bar (share of its
 * roadmap done). A row opens the subject in the full app; suggested subjects point to Memory.
 */
import { ProgressBar } from '@renderer/design-system'
import { useSubjects } from '@renderer/lib/queries'
import { APP_ROUTES } from '@shared/state'
import type { ReactNode } from 'react'
import { openApp } from '../panel-actions'
import { Note, Section, SectionError, SectionLoading } from '../Section'

export function SubjectsSection() {
  const subjects = useSubjects()
  let body: ReactNode = null
  if (subjects.isLoading) body = <SectionLoading label="Loading your subjects" />
  else if (!subjects.data) body = <SectionError error={subjects.error} />
  else {
    const active = subjects.data.filter((s) => s.status === 'active')
    const suggested = subjects.data.filter((s) => s.status === 'suggested').length
    body = (
      <>
        {active.length === 0 ? (
          <Note>No subjects yet. Dumbledore suggests them from what you read.</Note>
        ) : (
          <ul className="pn-list">
            {active.map((s) => (
              <li key={s.id}>
                <button
                  type="button"
                  className="pn-row pn-subject"
                  onClick={() => openApp(APP_ROUTES.subject(s.id))}
                >
                  <span className="pn-row__icon" aria-hidden>
                    {s.emoji}
                  </span>
                  <span className="pn-row__label">{s.name}</span>
                  <ProgressBar
                    value={s.progress}
                    showValue
                    width={118}
                    label={`${s.name} progress`}
                    className="pn-subject__bar"
                  />
                </button>
              </li>
            ))}
          </ul>
        )}
        {suggested > 0 ? (
          <button type="button" className="pn-link" onClick={() => openApp(APP_ROUTES.inbox)}>
            {suggested} suggested {suggested === 1 ? 'subject' : 'subjects'} · Review in Memory
          </button>
        ) : null}
      </>
    )
  }
  return <Section title="Subjects">{body}</Section>
}
