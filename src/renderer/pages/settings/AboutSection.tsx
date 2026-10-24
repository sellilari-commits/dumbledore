/**
 * Settings → About you: a few lines about the student that go into every prompt Dumbledore
 * writes, their level and the prompt language. Read with 'profile.get', saved with
 * 'profile.update'. The form is also used by onboarding (AboutFields).
 */
import { Button, ErrorState, Input, LoadingState, Textarea, toast } from '@renderer/design-system'
import { useProfile, useUpdateProfile } from '@renderer/lib/queries'
import type { Profile } from '@shared/domain'
import { useState } from 'react'
import { SelectMenu, type SelectOption, SettingsRow, SettingsSection } from './ui'

export type AboutDraft = Pick<Profile, 'aboutMe' | 'promptLanguage'> & { level: string }

export const LANGUAGES: SelectOption<Profile['promptLanguage']>[] = [
  { value: 'auto', label: 'Same as what I read' },
  { value: 'en', label: 'English' },
  { value: 'fi', label: 'Suomi' },
  { value: 'sv', label: 'Svenska' },
]

export const ABOUT_PLACEHOLDER =
  'e.g. Second-year chemistry student. I learn best from worked examples and like being quizzed.'

export function draftFrom(p: Pick<Profile, 'aboutMe' | 'level' | 'promptLanguage'>): AboutDraft {
  return { aboutMe: p.aboutMe, level: p.level ?? '', promptLanguage: p.promptLanguage }
}

export function patchFrom(d: AboutDraft) {
  return {
    aboutMe: d.aboutMe.trim(),
    level: d.level.trim() || null,
    promptLanguage: d.promptLanguage,
  }
}

export function sameDraft(a: AboutDraft, b: AboutDraft): boolean {
  return (
    a.aboutMe.trim() === b.aboutMe.trim() &&
    a.level.trim() === b.level.trim() &&
    a.promptLanguage === b.promptLanguage
  )
}

function AboutForm({ profile }: { profile: Profile }) {
  const saved = draftFrom(profile)
  const [draft, setDraft] = useState<AboutDraft>(saved)
  const update = useUpdateProfile({
    onSuccess: (p) => {
      setDraft(draftFrom(p))
      toast('Saved — your next prompts will use it', { tone: 'success' })
    },
    onError: (err) => toast(`Couldn’t save: ${err.message}`, { tone: 'error' }),
  })
  const dirty = !sameDraft(draft, saved)
  return (
    <>
      <SettingsRow
        label="About me"
        description="Your studies, your level and how you like to learn."
        stacked
      >
        <Textarea
          aria-label="About me"
          rows={4}
          placeholder={ABOUT_PLACEHOLDER}
          value={draft.aboutMe}
          onChange={(e) => setDraft({ ...draft, aboutMe: e.target.value })}
        />
      </SettingsRow>
      <SettingsRow label="Level" description="High school, university year 2, self-taught…">
        <Input
          aria-label="Level"
          placeholder="University, year 2"
          value={draft.level}
          onChange={(e) => setDraft({ ...draft, level: e.target.value })}
          style={{ width: 220 }}
        />
      </SettingsRow>
      <SettingsRow
        label="Prompt language"
        description="The language of the prompts written for your AI."
      >
        <SelectMenu
          label="Prompt language"
          value={draft.promptLanguage}
          options={LANGUAGES}
          onChange={(promptLanguage) => setDraft({ ...draft, promptLanguage })}
        />
      </SettingsRow>
      <div className="dd-set-actions">
        <Button
          variant="primary"
          disabled={!dirty}
          loading={update.isPending}
          onClick={() => update.mutate(patchFrom(draft))}
        >
          Save
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </>
  )
}

export function AboutSection() {
  const profile = useProfile()
  return (
    <SettingsSection
      title="About you"
      description="Goes into every prompt Dumbledore writes, so explanations start where you are."
    >
      {profile.isLoading ? (
        <LoadingState caption="Loading what you told Dumbledore…" lines={3} />
      ) : profile.isError || !profile.data ? (
        <ErrorState
          compact
          title="Couldn’t load your profile"
          error={profile.error}
          onRetry={() => profile.refetch()}
        />
      ) : (
        <AboutForm profile={profile.data} />
      )}
    </SettingsSection>
  )
}
