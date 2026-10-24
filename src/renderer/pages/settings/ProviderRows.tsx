/**
 * AI provider rows for Settings → AI providers: Apple on-device (switch + test), Groq and
 * Mistral (key entry through 'secrets.set' — keys are never shown again — plus a test), and
 * keyless OVHcloud (test only). Test results show inline: "✓ Connected · 310 ms" or the error.
 */
import { Button, Input, Switch, Tag, toast } from '@renderer/design-system'
import { useAction } from '@renderer/lib/queries'
import type { Settings } from '@shared/domain'
import { type FormEvent, useState } from 'react'
import { OkLabel, SettingsRow } from './ui'
import { useSettingsPatch } from './useSettingsPatch'

type ProviderId = 'apple' | 'groq' | 'ovh' | 'mistral'
type TestResult = { ok: boolean; latencyMs: number | null; error: string | null }

export function TestOutcome({ result }: { result: TestResult | null }) {
  if (!result) return null
  return result.ok ? (
    <OkLabel>Connected{result.latencyMs !== null ? ` · ${result.latencyMs} ms` : ''}</OkLabel>
  ) : (
    <span className="dd-set-bad" role="alert">
      {result.error ?? 'It didn’t answer.'}
    </span>
  )
}

export function useProviderTest(id: ProviderId) {
  const [result, setResult] = useState<TestResult | null>(null)
  const test = useAction('providers.test', {
    onSuccess: (r) => setResult(r),
    onError: (err) => setResult({ ok: false, latencyMs: null, error: err.message }),
  })
  return { result, run: () => test.mutate(id), running: test.isPending }
}

function TestButton({ id, label }: { id: ProviderId; label: string }) {
  const t = useProviderTest(id)
  return (
    <>
      <TestOutcome result={t.result} />
      <Button size="sm" onClick={t.run} loading={t.running} aria-label={`Test ${label}`}>
        Test
      </Button>
    </>
  )
}

export function AppleRow({ settings }: { settings: Settings }) {
  const { patch } = useSettingsPatch()
  return (
    <SettingsRow
      label={
        <>
          Apple on-device model <Tag color="green">Free · private</Tag>
        </>
      }
      description="Reads screen text on this Mac. Needs Apple Intelligence; English content only."
    >
      <TestButton id="apple" label="Apple on-device model" />
      <Switch
        label="Use the on-device model"
        checked={settings.ai.useOnDevice}
        onCheckedChange={(useOnDevice) => patch({ ai: { ...settings.ai, useOnDevice } })}
      />
    </SettingsRow>
  )
}

export function KeyRow({
  id,
  name,
  description,
  badge,
  keySet,
  placeholder,
}: {
  id: 'groq' | 'mistral'
  name: string
  description: string
  badge: { text: string; color: 'blue' | 'gray' }
  keySet: boolean
  placeholder: string
}) {
  const [draft, setDraft] = useState('')
  const [editing, setEditing] = useState(false)
  const t = useProviderTest(id)
  const save = useAction('secrets.set', {
    onSuccess: () => {
      setDraft('')
      setEditing(false)
      toast(`${name} key saved to your Keychain`, { tone: 'success' })
      t.run()
    },
    onError: (err) => toast(`Couldn’t save the key: ${err.message}`, { tone: 'error' }),
  })
  const submit = (e?: FormEvent) => {
    e?.preventDefault()
    if (draft.trim()) save.mutate({ key: id, value: draft.trim() })
  }
  const showForm = !keySet || editing
  return (
    <SettingsRow
      label={
        <>
          {name} <Tag color={badge.color}>{badge.text}</Tag>
        </>
      }
      description={
        <>
          {description}
          {t.result ? (
            <span style={{ display: 'block', marginTop: 4 }}>
              <TestOutcome result={t.result} />
            </span>
          ) : null}
        </>
      }
    >
      {showForm ? (
        <form onSubmit={submit} style={{ display: 'flex', gap: 8 }}>
          <Input
            type="password"
            aria-label={`${name} API key`}
            placeholder={placeholder}
            autoComplete="off"
            spellCheck={false}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            style={{ width: 200 }}
          />
          <Button type="submit" disabled={!draft.trim()} loading={save.isPending}>
            Save
          </Button>
          {editing ? (
            <Button variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          ) : null}
        </form>
      ) : (
        <>
          <OkLabel>Key saved</OkLabel>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Replace
          </Button>
          <Button size="sm" onClick={t.run} loading={t.running} aria-label={`Test ${name}`}>
            Test
          </Button>
        </>
      )}
    </SettingsRow>
  )
}

export function OvhRow() {
  return (
    <SettingsRow
      label={
        <>
          OVHcloud AI Endpoints <Tag color="gray">No key</Tag>
        </>
      }
      description="Free EU fallback, no account needed. Slower: 2 requests a minute."
    >
      <TestButton id="ovh" label="OVHcloud" />
    </SettingsRow>
  )
}
