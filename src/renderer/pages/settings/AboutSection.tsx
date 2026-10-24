/**
 * Settings → About you: a few lines about the student that go into every prompt Dumbledore
 * writes. Stored through lib/profile (a local stub until the contract has profile channels).
 */
import { Button, Input, Textarea, toast } from '@renderer/design-system'
import { type AboutYou, useAboutYou } from '@renderer/lib/profile'
import { useState } from 'react'
import { SelectMenu, type SelectOption, SettingsRow, SettingsSection } from './ui'

const LANGUAGES: SelectOption<AboutYou['promptLanguage']>[] = [
  { value: 'auto', label: 'Same as what I read' },
  { value: 'en', label: 'English' },
  { value: 'fi', label: 'Suomi' },
  { value: 'sv', label: 'Svenska' },
]

export function AboutSection() {
  const [saved, save] = useAboutYou()
  const [draft, setDraft] = useState<AboutYou>(saved)
  const dirty =
    draft.aboutMe !== saved.aboutMe ||
    draft.level !== saved.level ||
    draft.promptLanguage !== saved.promptLanguage
  return (
    <SettingsSection
      title="About you"
      description="Goes into every prompt Dumbledore writes, so explanations start where you are."
    >
      <SettingsRow label="About me" description="Your studies, your level and how you like to learn." stacked>
        <Textarea
          aria-label="About me"
          rows={4}
          placeholder="e.g. Second-year chemistry student. I learn best from worked examples and like being quizzed."
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
      <SettingsRow label="Prompt language" description="The language of the prompts written for your AI.">
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
          onClick={() => {
            save(draft)
            toast('Saved — your next prompts will use it', { tone: 'success' })
          }}
        >
          Save
        </Button>
        {dirty ? (
          <Button variant="ghost" onClick={() => setDraft(saved)}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </SettingsSection>
  )
}
