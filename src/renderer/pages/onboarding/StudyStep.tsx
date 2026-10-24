/**
 * Onboarding 5/6 — "What are you studying?": subjects with deadlines (SubjectsCard) and
 * "About you" (a few lines + level), saved through 'profile.update' on Continue. Everything is
 * optional: Dumbledore also suggests subjects from what it sees.
 */
import { Button, Field, Input, Textarea, toast } from '@renderer/design-system'
import { useProfile, useUpdateProfile } from '@renderer/lib/queries'
import { useState } from 'react'
import {
  ABOUT_PLACEHOLDER,
  type AboutDraft,
  draftFrom,
  patchFrom,
  sameDraft,
} from '../settings/AboutSection'
import { StepFrame } from './StepFrame'
import { SubjectsCard } from './SubjectsCard'

const EMPTY: AboutDraft = { aboutMe: '', level: '', promptLanguage: 'auto' }

export function StudyStep({ onNext, onBack }: { onNext: () => void; onBack: () => void }) {
  const profile = useProfile()
  const saved = profile.data ? draftFrom(profile.data) : EMPTY
  // Untouched fields follow the saved profile; the first edit makes a local draft.
  const [draft, setDraft] = useState<AboutDraft | null>(null)
  const current = draft ?? saved
  const update = useUpdateProfile({
    onSuccess: onNext,
    onError: (err) => toast(`Couldn’t save About you: ${err.message}`, { tone: 'error' }),
  })
  const next = () => {
    if (sameDraft(current, saved)) onNext()
    else update.mutate(patchFrom(current))
  }
  return (
    <StepFrame
      step={4}
      title="What are you studying?"
      lead="Add your subjects and any exam dates. Dumbledore files what you read under them and plans reviews before each deadline."
      back={
        <Button variant="ghost" onClick={onBack}>
          Back
        </Button>
      }
      actions={
        <Button variant="primary" onClick={next} loading={update.isPending}>
          Continue
        </Button>
      }
    >
      <SubjectsCard />
      <p className="dd-onb__hint">
        Dates are optional — add one for an exam or deadline. No rush: Dumbledore also suggests
        subjects from what you read.
      </p>
      <div className="dd-onb__about">
        <h2 className="dd-onb__subtitle">About you</h2>
        <Field
          label="A few lines about you"
          hint="Goes into every prompt, so explanations start where you are."
        >
          {(id) => (
            <Textarea
              id={id}
              rows={3}
              placeholder={ABOUT_PLACEHOLDER}
              value={current.aboutMe}
              onChange={(e) => setDraft({ ...current, aboutMe: e.target.value })}
            />
          )}
        </Field>
        <Field label="Level">
          {(id) => (
            <Input
              id={id}
              placeholder="High school, university year 2, self-taught…"
              value={current.level}
              onChange={(e) => setDraft({ ...current, level: e.target.value })}
            />
          )}
        </Field>
      </div>
    </StepFrame>
  )
}
