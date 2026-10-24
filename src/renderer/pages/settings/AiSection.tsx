/**
 * Settings → AI providers: Gemini 3.5 first (the primary, with its live key status), then the
 * fallbacks in router order — Groq, OVHcloud (no key), Mistral, Apple on-device — and today's
 * usage per model.
 */
import type { Settings } from '@shared/domain'
import { GeminiRow } from './GeminiRow'
import { AppleRow, KeyRow, OvhRow } from './ProviderRows'
import { UsageMeters } from './UsageMeters'
import { SettingsSection } from './ui'

export function AiSection({ settings }: { settings: Settings }) {
  return (
    <>
      <SettingsSection
        title="AI providers"
        description="Gemini does the thinking; the others take over when it’s busy. Text is redacted before it leaves your Mac, and keys live in the macOS Keychain."
      >
        <GeminiRow keySet={settings.ai.geminiKeySet} />
        <KeyRow
          id="groq"
          name="Groq"
          badge={{ text: 'Free fallback', color: 'gray' }}
          description="Fast backup for roadmaps and prompts. Free tier, no card: console.groq.com → API Keys."
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
        <AppleRow settings={settings} />
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
