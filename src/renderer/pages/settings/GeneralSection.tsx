/**
 * Settings → General: appearance and focus subject. (No auto-send: Dumbledore pastes the prompt
 * and the student presses Enter; Settings.autoSend stays only for old data.)
 */
import { useSubjects } from '@renderer/lib/queries'
import { applyTheme } from '@renderer/lib/theme'
import type { Settings } from '@shared/domain'
import { SelectMenu, SettingsRow, SettingsSection } from './ui'
import { useSettingsPatch } from './useSettingsPatch'

const THEMES = [
  { value: 'system', label: 'Use system setting' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
] as const

export function GeneralSection({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  const subjects = useSubjects()
  const active = (subjects.data ?? []).filter((s) => s.status === 'active')
  const focusOptions = [
    { value: 'none', label: 'No focus' },
    ...active.map((s) => ({ value: s.id, label: `${s.emoji} ${s.name}` })),
  ]
  return (
    <SettingsSection
      title="General"
      description="How Dumbledore looks and how it hands you prompts."
    >
      <SettingsRow
        label="Appearance"
        description="Follow your Mac, or stay light or dark. ⌘⇧L switches any time."
      >
        <SelectMenu
          label="Appearance"
          value={settings.theme}
          options={THEMES}
          onChange={(theme) => {
            applyTheme(theme)
            patch({ theme })
          }}
        />
      </SettingsRow>
      <SettingsRow
        label="Focus subject"
        description="Ranked first in suggestions, reviews and the study picker."
      >
        <SelectMenu
          label="Focus subject"
          value={settings.focusSubjectId ?? 'none'}
          options={focusOptions}
          onChange={(id) => patch({ focusSubjectId: id === 'none' ? null : id })}
        />
      </SettingsRow>
    </SettingsSection>
  )
}
