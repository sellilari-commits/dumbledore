/** Settings → AI providers: provider rows (keys, tests) and today's usage vs free limits. */
import type { Settings } from '@shared/domain'
import { AppleRow, KeyRow, OvhRow } from './ProviderRows'
import { SettingsSection } from './ui'
import { UsageMeters } from './UsageMeters'

export function AiSection({ settings }: { settings: Settings }) {
  return (
    <>
      <SettingsSection
        title="AI providers"
        description="Free tiers only. Text is redacted before it leaves your Mac; keys live in the macOS Keychain."
      >
        <AppleRow settings={settings} />
        <KeyRow
          id="groq"
          name="Groq"
          badge={{ text: 'Primary', color: 'blue' }}
          description="Writes roadmaps, quizzes and prompts. Free tier, no card: console.groq.com → API Keys."
          keySet={settings.ai.groqKeySet}
          placeholder="gsk_…"
        />
        <OvhRow />
        <KeyRow
          id="mistral"
          name="Mistral"
          badge={{ text: 'Optional', color: 'gray' }}
          description="An extra EU fallback. Turn off “Anonymous improvement data” in your Mistral account."
          keySet={settings.ai.mistralKeySet}
          placeholder="Mistral API key"
        />
      </SettingsSection>
      <SettingsSection
        title="Today’s usage"
        description="Calls and tokens per model, against each free tier’s daily limit."
      >
        <UsageMeters />
      </SettingsSection>
    </>
  )
}
